use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const TOR_TEMP_DIR_PREFIX: &str = "pulso-tor-";

#[cfg(unix)]
mod unix_pg {
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    extern "C" {
        fn setpgid(pid: i32, pgid: i32) -> i32;
        fn killpg(pgrp: i32, sig: i32) -> i32;
    }

    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;

    pub fn configure_process_group(cmd: &mut Command) {
        // Safety: `setpgid(0, 0)` is async-signal-safe and isolates the child and all
        // descendants (`sidecar` -> `tor` -> `lyrebird` / `cloudflared`) in their own PGID.
        unsafe {
            cmd.pre_exec(|| {
                if setpgid(0, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    pub fn signal_process_group_term(pid: u32) {
        unsafe {
            let _ = killpg(pid as i32, SIGTERM);
        }
    }

    pub fn signal_process_group_kill(pid: u32) {
        unsafe {
            let _ = killpg(pid as i32, SIGKILL);
        }
    }
}

#[cfg(windows)]
mod win_job {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[repr(C)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *mut c_void, lp_name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            h_job: *mut c_void,
            job_object_information_class: u32,
            lp_job_object_information: *const c_void,
            cb_job_object_information_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(h_job: *mut c_void, h_process: *mut c_void) -> i32;
        fn TerminateJobObject(h_job: *mut c_void, u_exit_code: u32) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    pub struct JobGuard {
        handle: *mut c_void,
    }

    unsafe impl Send for JobGuard {}
    unsafe impl Sync for JobGuard {}

    impl JobGuard {
        pub fn attach(child: &Child) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut info: JobObjectExtendedLimitInformation = std::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
                );
                if ok == 0 {
                    CloseHandle(job);
                    return None;
                }
                let assigned = AssignProcessToJobObject(job, child.as_raw_handle() as *mut c_void);
                if assigned == 0 {
                    CloseHandle(job);
                    return None;
                }
                Some(Self { handle: job })
            }
        }

        pub fn terminate(&self) {
            unsafe {
                let _ = TerminateJobObject(self.handle, 1);
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    pub fn configure_process_group(cmd: &mut Command) {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub struct ManagedProcess {
    pub child: Child,
    #[cfg(windows)]
    job: Option<win_job::JobGuard>,
}

impl ManagedProcess {
    pub fn spawn(program: &Path, args: &[String], stdin_line: Option<&str>) -> io::Result<Self> {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        unix_pg::configure_process_group(&mut cmd);
        #[cfg(windows)]
        win_job::configure_process_group(&mut cmd);

        let mut child = cmd.spawn()?;

        #[cfg(windows)]
        let job = win_job::JobGuard::attach(&child);

        if let Some(line) = stdin_line {
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                stdin.write_all(line.as_bytes())?;
                stdin.write_all(b"\n")?;
                stdin.flush()?;
                // Keep stdin pipe alive inside ManagedProcess? Dropping stdin sends EOF immediately
                // unless kept, so only drop on shutdown! We restore stdin via a wrapper or keep Option.
                // Wait: `take()` would drop `stdin` at end of scope and trigger `--watch-stdin` EOF!
                // Re-attach by putting `stdin` back on `child.stdin` so pipe stays open until stop.
                child.stdin = Some(stdin);
            }
        }

        Ok(Self {
            child,
            #[cfg(windows)]
            job,
        })
    }

    /// Gracefully terminates the entire child process group (and Job Object on Windows).
    pub fn terminate_tree(&mut self, grace: Duration) {
        // Closing stdin triggers `--watch-stdin` graceful shutdown in `pulso-sidecar`.
        drop(self.child.stdin.take());

        #[cfg(unix)]
        {
            let pid = self.child.id();
            unix_pg::signal_process_group_term(pid);
            let deadline = std::time::Instant::now() + grace;
            while std::time::Instant::now() < deadline {
                if let Ok(Some(_)) = self.child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            unix_pg::signal_process_group_kill(pid);
            let _ = self.child.wait();
        }

        #[cfg(windows)]
        {
            let deadline = std::time::Instant::now() + grace;
            while std::time::Instant::now() < deadline {
                if let Ok(Some(_)) = self.child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            if let Some(job) = &self.job {
                job.terminate();
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

pub fn create_ephemeral_tor_dir_in(base_dir: &Path) -> io::Result<PathBuf> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    for attempt in 0..16u32 {
        let candidate = base_dir.join(format!("{TOR_TEMP_DIR_PREFIX}{pid}-{ts}-{attempt}"));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700));
                }
                return Ok(candidate);
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Unable to allocate ephemeral Tor data directory",
    ))
}

pub fn create_ephemeral_tor_dir() -> io::Result<PathBuf> {
    create_ephemeral_tor_dir_in(&std::env::temp_dir())
}

pub fn is_safe_tor_temp_dir_in(path: &Path, base_dir: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !name.starts_with(TOR_TEMP_DIR_PREFIX) {
        return false;
    }
    path.parent().map_or(false, |parent| parent == base_dir)
}

pub fn purge_tor_temp_dir_in(path: &Path, base_dir: &Path) -> io::Result<bool> {
    if !is_safe_tor_temp_dir_in(path, base_dir) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Refusing to purge path outside ephemeral Tor prefix",
        ));
    }
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(path)?;
    Ok(true)
}

pub fn purge_tor_temp_dir(path: &Path) -> io::Result<bool> {
    purge_tor_temp_dir_in(path, &std::env::temp_dir())
}

pub fn cleanup_stale_tor_dirs_in(base_dir: &Path, max_age: Duration) -> io::Result<usize> {
    let now = SystemTime::now();
    let mut removed = 0usize;
    for entry in fs::read_dir(base_dir)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !is_safe_tor_temp_dir_in(&path, base_dir) || !path.is_dir() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(now);
        let age = now.duration_since(modified).unwrap_or_default();
        if age >= max_age && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_purges_ephemeral_tor_dir_with_prefix_guard() {
        let sandbox = std::env::temp_dir().join(format!(
            "pulso-rust-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&sandbox).unwrap();

        let tor_dir = create_ephemeral_tor_dir_in(&sandbox).unwrap();
        assert!(tor_dir.exists());
        assert!(is_safe_tor_temp_dir_in(&tor_dir, &sandbox));

        let marker = tor_dir.join("torrc");
        fs::write(&marker, "SocksPort 0\n").unwrap();

        assert!(purge_tor_temp_dir_in(&tor_dir, &sandbox).unwrap());
        assert!(!tor_dir.exists());

        // Refuses to purge an arbitrary directory without pulso-tor- prefix
        let unsafe_dir = sandbox.join("unrelated-dir");
        fs::create_dir_all(&unsafe_dir).unwrap();
        assert!(purge_tor_temp_dir_in(&unsafe_dir, &sandbox).is_err());
        assert!(unsafe_dir.exists());

        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn cleans_up_stale_tor_dirs_only_when_older_than_max_age() {
        let sandbox = std::env::temp_dir().join(format!(
            "pulso-rust-stale-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&sandbox).unwrap();

        let tor_dir = create_ephemeral_tor_dir_in(&sandbox).unwrap();
        // With zero max_age, directory qualifies as stale immediately
        let removed = cleanup_stale_tor_dirs_in(&sandbox, Duration::from_secs(0)).unwrap();
        assert_eq!(removed, 1);
        assert!(!tor_dir.exists());

        let _ = fs::remove_dir_all(&sandbox);
    }

    #[cfg(unix)]
    #[test]
    fn spawns_child_in_isolated_process_group_and_terminates_tree() {
        let mut proc = ManagedProcess::spawn(
            Path::new("/bin/sh"),
            &["-c".to_string(), "sleep 30".to_string()],
            None,
        )
        .unwrap();
        assert!(proc.child.try_wait().unwrap().is_none());
        proc.terminate_tree(Duration::from_millis(500));
        assert!(proc.child.try_wait().unwrap().is_some());
    }
}
