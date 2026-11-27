pub mod flavor;
pub mod process_tree;
pub mod sidecar_protocol;
pub mod tray;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use crate::flavor::{current_flavor, Flavor};
use crate::process_tree::{
    cleanup_stale_tor_dirs_in, create_ephemeral_tor_dir, ensure_tor_temp_dir_purged,
    ManagedProcess,
};
use crate::sidecar_protocol::{
    build_local_spawn_plan, build_tor_spawn_plan, is_allowed_browser_url,
    parse_sidecar_event_line, BridgeMode, ParsedSidecarEvent, SidecarSpawnPlan, TurnConfigInput,
};
use crate::tray::{notify_minimized_to_tray, setup_tray};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlavorInfoResponse {
    pub flavor: String,
    pub app_version: String,
    pub tor_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnConfigPayload {
    pub turn_urls: Option<Vec<String>>,
    pub turn_username: Option<String>,
    pub turn_credential: Option<String>,
    pub turn_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPurgeResponse {
    pub purged_data_dir: bool,
}

#[derive(Default)]
struct SupervisorInner {
    process: Option<ManagedProcess>,
    tor_data_dir: Option<PathBuf>,
    local_url: Option<String>,
    active: bool,
    auto_opened: bool,
}

#[derive(Clone, Default)]
pub struct AppState {
    inner: Arc<Mutex<SupervisorInner>>,
}

fn binary_name_with_ext(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn resolve_bundled_executable(app: &AppHandle, base_name: &str) -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or_else(|| format!("Unable to resolve current executable directory for {base_name}"))?;

    let plain = exe_dir.join(binary_name_with_ext(base_name));
    if plain.exists() {
        return Ok(plain);
    }

    let triple = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        ""
    };

    if !triple.is_empty() {
        let triple_name = if cfg!(windows) {
            format!("{base_name}-{triple}.exe")
        } else {
            format!("{base_name}-{triple}")
        };
        let candidate = exe_dir.join(&triple_name);
        if candidate.exists() {
            return Ok(candidate);
        }
        let dev_candidate = exe_dir.join("binaries").join(&triple_name);
        if dev_candidate.exists() {
            return Ok(dev_candidate);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let res_candidate = resource_dir.join("binaries").join(binary_name_with_ext(base_name));
        if res_candidate.exists() {
            return Ok(res_candidate);
        }
    }

    Err(format!("Bundled executable '{base_name}' not found next to {}", exe_dir.display()))
}

fn resolve_static_dist_dir(app: &AppHandle) -> Option<String> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let dist_dir = res_dir.join("dist");
        if dist_dir.join("index.html").exists() {
            return Some(dist_dir.to_string_lossy().into_owned());
        }
    }
    None
}

fn resolve_bundled_tor_paths(app: &AppHandle) -> (Option<String>, Option<String>) {
    let Ok(res_dir) = app.path().resource_dir() else {
        return (None, None);
    };
    let tor_bin = res_dir.join("tor").join(binary_name_with_ext("tor"));
    let lyrebird_bin = res_dir
        .join("tor")
        .join("pluggable_transports")
        .join(binary_name_with_ext("lyrebird"));

    (
        tor_bin.exists().then(|| tor_bin.to_string_lossy().into_owned()),
        lyrebird_bin
            .exists()
            .then(|| lyrebird_bin.to_string_lossy().into_owned()),
    )
}

fn open_url_safely(app: &AppHandle, url: &str) -> Result<(), String> {
    if !is_allowed_browser_url(url) {
        return Err("Refusing to open disallowed URL scheme in browser".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| format!("Failed to open browser: {err}"))
}

fn stop_active_instance(state: &AppState) -> StopPurgeResponse {
    let mut guard = state.inner.lock().expect("supervisor mutex poisoned");
    if let Some(mut proc_handle) = guard.process.take() {
        proc_handle.terminate_tree(Duration::from_secs(3));
    }
    let tor_data_dir = guard.tor_data_dir.take();
    let purged_data_dir = ensure_tor_temp_dir_purged(tor_data_dir.as_deref());
    guard.local_url = None;
    guard.active = false;
    guard.auto_opened = false;
    StopPurgeResponse { purged_data_dir }
}

fn spawn_supervised_sidecar(
    app: &AppHandle,
    state: &AppState,
    plan: SidecarSpawnPlan,
    tor_data_dir: Option<PathBuf>,
) -> Result<(), String> {
    let _ = stop_active_instance(state);

    let sidecar_path = resolve_bundled_executable(app, "pulso-sidecar")?;
    let mut managed = ManagedProcess::spawn(&sidecar_path, &plan.args, plan.stdin_json.as_deref())
        .map_err(|err| format!("Failed to spawn pulso-sidecar: {err}"))?;

    let stdout = managed.child.stdout.take();
    let stderr = managed.child.stderr.take();

    {
        let mut guard = state.inner.lock().expect("supervisor mutex poisoned");
        guard.process = Some(managed);
        guard.tor_data_dir = tor_data_dir;
        guard.local_url = None;
        guard.active = true;
        guard.auto_opened = false;
    }

    if let Some(out) = stdout {
        let app_handle = app.clone();
        let state_clone = state.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line_res in reader.lines() {
                let Ok(line) = line_res else {
                    break;
                };
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&line) {
                    let _ = app_handle.emit("pulso://sidecar-event", json_val);
                }

                match parse_sidecar_event_line(&line) {
                    ParsedSidecarEvent::Listening {
                        mode,
                        local_url,
                        tunnel_enabled,
                    } => {
                        let mut should_open: Option<String> = None;
                        {
                            let mut guard = state_clone.inner.lock().expect("supervisor mutex");
                            if !local_url.is_empty() {
                                guard.local_url = Some(local_url.clone());
                                if mode == "local" && !tunnel_enabled && !guard.auto_opened {
                                    guard.auto_opened = true;
                                    should_open = Some(local_url);
                                }
                            }
                        }
                        if let Some(url) = should_open {
                            let _ = open_url_safely(&app_handle, &url);
                        }
                    }
                    ParsedSidecarEvent::TorReady { .. }
                    | ParsedSidecarEvent::TunnelReady { .. }
                    | ParsedSidecarEvent::TunnelError => {
                        let mut should_open: Option<String> = None;
                        {
                            let mut guard = state_clone.inner.lock().expect("supervisor mutex");
                            if !guard.auto_opened {
                                if let Some(url) = guard.local_url.clone() {
                                    guard.auto_opened = true;
                                    should_open = Some(url);
                                }
                            }
                        }
                        if let Some(url) = should_open {
                            let _ = open_url_safely(&app_handle, &url);
                        }
                    }
                    ParsedSidecarEvent::Stopped => {
                        let mut guard = state_clone.inner.lock().expect("supervisor mutex");
                        guard.active = false;
                    }
                    _ => {}
                }
            }
        });
    }

    if let Some(err_stream) = stderr {
        std::thread::spawn(move || {
            let reader = BufReader::new(err_stream);
            for _ in reader.lines() {
                // Drain stderr so child never blocks on a full pipe.
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn get_flavor_info(app: AppHandle) -> FlavorInfoResponse {
    let flavor = current_flavor();
    FlavorInfoResponse {
        flavor: flavor.id().to_string(),
        app_version: app.package_info().version.to_string(),
        tor_version: flavor.tor_version().map(str::to_string),
    }
}

#[tauri::command]
fn start_tor_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    bridge_mode: String,
    custom_bridges: Option<String>,
) -> Result<(), String> {
    if current_flavor() != Flavor::Tor {
        return Err("Tor mode is only available in PULSO Tor flavor".to_string());
    }
    let parsed_mode = BridgeMode::parse(&bridge_mode)
        .ok_or_else(|| format!("Invalid Tor bridge mode: {bridge_mode}"))?;

    let tor_data_dir = create_ephemeral_tor_dir()
        .map_err(|err| format!("Failed to create temporary Tor directory: {err}"))?;
    let static_dir = resolve_static_dist_dir(&app);
    let (tor_bin, lyrebird_bin) = resolve_bundled_tor_paths(&app);
    let tor_data_str = tor_data_dir.to_string_lossy().into_owned();

    let plan = build_tor_spawn_plan(
        parsed_mode,
        custom_bridges.as_deref(),
        static_dir.as_deref(),
        tor_bin.as_deref(),
        lyrebird_bin.as_deref(),
        Some(&tor_data_str),
    );

    spawn_supervised_sidecar(&app, &state, plan, Some(tor_data_dir))
}

#[tauri::command]
fn restart_tor_with_snowflake(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    start_tor_instance(app, state, "snowflake".to_string(), None)
}

#[tauri::command]
fn start_local_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    enable_tunnel: bool,
    turn_config: Option<TurnConfigPayload>,
) -> Result<(), String> {
    if current_flavor() != Flavor::Local {
        return Err("Local/Tunnel mode is only available in PULSO Local flavor".to_string());
    }
    let static_dir = resolve_static_dist_dir(&app);
    let cloudflared_bin = if enable_tunnel {
        resolve_bundled_executable(&app, "cloudflared")
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    };

    let turn_input = turn_config.map(|cfg| TurnConfigInput {
        turn_urls: cfg.turn_urls.unwrap_or_default(),
        turn_username: cfg.turn_username,
        turn_credential: cfg.turn_credential,
        turn_secret: cfg.turn_secret,
    });

    let plan = build_local_spawn_plan(
        enable_tunnel,
        turn_input.as_ref(),
        static_dir.as_deref(),
        cloudflared_bin.as_deref(),
    );

    spawn_supervised_sidecar(&app, &state, plan, None)
}

#[tauri::command]
fn stop_and_purge(state: State<'_, AppState>) -> StopPurgeResponse {
    stop_active_instance(&state)
}

#[tauri::command]
fn open_in_browser(app: AppHandle, url: String) -> Result<(), String> {
    open_url_safely(&app, &url)
}

pub fn run() {
    let _ = cleanup_stale_tor_dirs_in(&std::env::temp_dir(), Duration::from_secs(15 * 60));

    let flavor = current_flavor();
    let app_state = AppState::default();

    let app = tauri::Builder::default()
        .manage(app_state.clone())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle();
            let open_state = app_state.clone();
            let quit_state = app_state.clone();

            setup_tray(
                handle,
                flavor.product_name(),
                move |app_handle| {
                    let maybe_url = open_state
                        .inner
                        .lock()
                        .ok()
                        .and_then(|guard| guard.local_url.clone());
                    if let Some(url) = maybe_url {
                        let _ = open_url_safely(app_handle, &url);
                    }
                },
                move |app_handle| {
                    let _ = stop_active_instance(&quit_state);
                    app_handle.exit(0);
                },
            )?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let is_active = state
                    .inner
                    .lock()
                    .map_or(false, |guard| guard.active);
                if is_active {
                    api.prevent_close();
                    let _ = window.hide();
                    notify_minimized_to_tray(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_flavor_info,
            start_tor_instance,
            restart_tor_with_snowflake,
            start_local_instance,
            stop_and_purge,
            open_in_browser
        ])
        .build(tauri::generate_context!())
        .expect("error while building PULSO desktop application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            let state = app_handle.state::<AppState>();
            let _ = stop_active_instance(&state);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_active_instance_reports_purged_even_when_sidecar_already_deleted_temp_dir() {
        let state = AppState::default();
        let tor_dir = create_ephemeral_tor_dir().unwrap();
        std::fs::remove_dir_all(&tor_dir).unwrap();

        {
            let mut guard = state.inner.lock().unwrap();
            guard.tor_data_dir = Some(tor_dir);
            guard.active = true;
        }

        let response = stop_active_instance(&state);
        assert!(response.purged_data_dir);
        assert!(!state.inner.lock().unwrap().active);
    }
}
