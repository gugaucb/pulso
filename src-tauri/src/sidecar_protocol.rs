#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeMode {
    Direct,
    Snowflake,
    Custom,
}

impl BridgeMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "direct" => Some(Self::Direct),
            "snowflake" => Some(Self::Snowflake),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }

    pub const fn as_cli_value(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Snowflake => "snowflake",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnConfigInput {
    pub turn_urls: Vec<String>,
    pub turn_username: Option<String>,
    pub turn_credential: Option<String>,
    pub turn_secret: Option<String>,
}

impl TurnConfigInput {
    pub fn is_empty(&self) -> bool {
        self.turn_urls.is_empty()
            && self.turn_username.as_deref().map_or(true, |v| v.trim().is_empty())
            && self.turn_credential.as_deref().map_or(true, |v| v.trim().is_empty())
            && self.turn_secret.as_deref().map_or(true, |v| v.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarSpawnPlan {
    pub args: Vec<String>,
    pub stdin_json: Option<String>,
}

pub fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                use std::fmt::Write;
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn build_tor_spawn_plan(
    bridge_mode: BridgeMode,
    custom_bridges: Option<&str>,
    static_dir: Option<&str>,
    tor_bin: Option<&str>,
    lyrebird_bin: Option<&str>,
    tor_data_dir: Option<&str>,
) -> SidecarSpawnPlan {
    let mut args = vec![
        "--mode".to_string(),
        "tor".to_string(),
        "--port".to_string(),
        "0".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--bridge-mode".to_string(),
        bridge_mode.as_cli_value().to_string(),
        "--watch-stdin".to_string(),
    ];

    if let Some(dir) = static_dir {
        args.push("--static-dir".to_string());
        args.push(dir.to_string());
    }
    if let Some(bin) = tor_bin {
        args.push("--tor-bin".to_string());
        args.push(bin.to_string());
    }
    if let Some(bin) = lyrebird_bin {
        args.push("--lyrebird-bin".to_string());
        args.push(bin.to_string());
    }
    if let Some(dir) = tor_data_dir {
        args.push("--tor-data-dir".to_string());
        args.push(dir.to_string());
    }

    let stdin_json = if bridge_mode == BridgeMode::Custom {
        args.push("--stdin-config".to_string());
        let bridges = custom_bridges.unwrap_or("").trim();
        Some(format!("{{\"customBridges\":{}}}", json_escape(bridges)))
    } else {
        None
    };

    SidecarSpawnPlan { args, stdin_json }
}

pub fn build_local_spawn_plan(
    enable_tunnel: bool,
    turn_config: Option<&TurnConfigInput>,
    static_dir: Option<&str>,
    cloudflared_bin: Option<&str>,
) -> SidecarSpawnPlan {
    let mut args = vec![
        "--mode".to_string(),
        "local".to_string(),
        "--port".to_string(),
        "0".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--watch-stdin".to_string(),
    ];

    if let Some(dir) = static_dir {
        args.push("--static-dir".to_string());
        args.push(dir.to_string());
    }
    if enable_tunnel {
        args.push("--tunnel".to_string());
        if let Some(bin) = cloudflared_bin {
            args.push("--cloudflared-bin".to_string());
            args.push(bin.to_string());
        }
    }

    let stdin_json = match turn_config {
        Some(cfg) if !cfg.is_empty() => {
            args.push("--stdin-config".to_string());
            let mut fields = Vec::new();
            if !cfg.turn_urls.is_empty() {
                let urls_json: Vec<String> = cfg.turn_urls.iter().map(|u| json_escape(u)).collect();
                fields.push(format!("\"turnUrls\":[{}]", urls_json.join(",")));
            }
            if let Some(username) = cfg.turn_username.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                fields.push(format!("\"turnUsername\":{}", json_escape(username)));
            }
            if let Some(credential) = cfg.turn_credential.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                fields.push(format!("\"turnCredential\":{}", json_escape(credential)));
            }
            if let Some(secret) = cfg.turn_secret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                fields.push(format!("\"turnSecret\":{}", json_escape(secret)));
            }
            Some(format!("{{\"turnConfig\":{{{}}}}}", fields.join(",")))
        }
        _ => None,
    };

    SidecarSpawnPlan { args, stdin_json }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedSidecarEvent {
    Listening {
        mode: String,
        local_url: String,
        tunnel_enabled: bool,
    },
    TorReady {
        onion_address: String,
    },
    TunnelReady {
        public_origin: String,
    },
    TunnelError,
    Stopped,
    Other,
}

fn extract_json_string_field(line: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\":", key);
    let idx = line.find(&needle)?;
    let rest = line[idx + needle.len()..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    let mut out = String::new();
    let mut escaped = false;
    for ch in rest[1..].chars() {
        if escaped {
            match ch {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                other => out.push(other),
            }
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn extract_json_bool_field(line: &str, key: &str) -> Option<bool> {
    let needle = format!("\"{}\":", key);
    let idx = line.find(&needle)?;
    let rest = line[idx + needle.len()..].trim_start();
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

pub fn parse_sidecar_event_line(line: &str) -> ParsedSidecarEvent {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return ParsedSidecarEvent::Other;
    }
    let event = match extract_json_string_field(trimmed, "event") {
        Some(ev) => ev,
        None => return ParsedSidecarEvent::Other,
    };

    match event.as_str() {
        "listening" => {
            let mode = extract_json_string_field(trimmed, "mode").unwrap_or_default();
            let local_url = extract_json_string_field(trimmed, "localUrl").unwrap_or_default();
            let tunnel_enabled = extract_json_bool_field(trimmed, "tunnelEnabled").unwrap_or(false);
            ParsedSidecarEvent::Listening {
                mode,
                local_url,
                tunnel_enabled,
            }
        }
        "tor_ready" => ParsedSidecarEvent::TorReady {
            onion_address: extract_json_string_field(trimmed, "onionAddress").unwrap_or_default(),
        },
        "tunnel_ready" => ParsedSidecarEvent::TunnelReady {
            public_origin: extract_json_string_field(trimmed, "publicOrigin").unwrap_or_default(),
        },
        "tunnel_error" => ParsedSidecarEvent::TunnelError,
        "stopped" => ParsedSidecarEvent::Stopped,
        _ => ParsedSidecarEvent::Other,
    }
}

/// Only allows local loopback room URLs or HTTPS release URLs to be opened in the OS browser.
pub fn is_allowed_browser_url(raw_url: &str) -> bool {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    if let Some(rest) = trimmed.strip_prefix("http://127.0.0.1:") {
        let port_part = rest.split('/').next().unwrap_or("");
        return !port_part.is_empty() && port_part.parse::<u16>().map_or(false, |p| p > 0);
    }
    trimmed.starts_with("https://") && trimmed.len() > "https://".len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tor_custom_bridges_pass_exclusively_via_stdin_json_and_never_argv() {
        let secret_bridge = "obfs4 198.51.100.10:443 ABCDEF0123456789ABCDEF0123456789ABCDEF01 cert=abc iat-mode=0";
        let plan = build_tor_spawn_plan(
            BridgeMode::Custom,
            Some(secret_bridge),
            Some("/app/Resources/dist"),
            Some("/app/Resources/tor/tor"),
            Some("/app/Resources/tor/pluggable_transports/lyrebird"),
            Some("/tmp/pulso-tor-123"),
        );

        assert!(plan.args.contains(&"--stdin-config".to_string()));
        assert!(plan.args.contains(&"--watch-stdin".to_string()));
        assert!(!plan.args.iter().any(|arg| arg.contains("198.51.100.10")));
        assert!(!plan.args.iter().any(|arg| arg == "--custom-bridges"));

        let stdin_json = plan.stdin_json.expect("stdin JSON must be generated");
        assert!(!stdin_json.contains('\n'));
        assert!(stdin_json.contains("\"customBridges\":\"obfs4 198.51.100.10:443"));
    }

    #[test]
    fn local_turn_credentials_pass_exclusively_via_stdin_json_and_never_argv() {
        let turn = TurnConfigInput {
            turn_urls: vec!["turn:turn.example.org:3478".to_string()],
            turn_username: Some("alice".to_string()),
            turn_credential: Some("s3cr3t-pass".to_string()),
            turn_secret: None,
        };
        let plan = build_local_spawn_plan(
            true,
            Some(&turn),
            Some("/app/Resources/dist"),
            Some("/app/MacOS/cloudflared"),
        );

        assert!(plan.args.contains(&"--tunnel".to_string()));
        assert!(plan.args.contains(&"--stdin-config".to_string()));
        assert!(!plan.args.iter().any(|arg| arg.contains("s3cr3t-pass")));
        assert!(!plan.args.iter().any(|arg| arg.contains("turn.example.org")));

        let stdin_json = plan.stdin_json.expect("stdin JSON must be generated");
        assert!(stdin_json.contains("\"turnConfig\":{"));
        assert!(stdin_json.contains("\"turnUrls\":[\"turn:turn.example.org:3478\"]"));
        assert!(stdin_json.contains("\"turnCredential\":\"s3cr3t-pass\""));
    }

    #[test]
    fn parses_sidecar_ndjson_events_cleanly() {
        let listening = parse_sidecar_event_line(
            r#"{"event":"listening","mode":"local","port":39120,"localUrl":"http://127.0.0.1:39120","tunnelEnabled":true}"#,
        );
        assert_eq!(
            listening,
            ParsedSidecarEvent::Listening {
                mode: "local".to_string(),
                local_url: "http://127.0.0.1:39120".to_string(),
                tunnel_enabled: true,
            }
        );

        let tor_ready = parse_sidecar_event_line(
            r#"{"event":"tor_ready","onionAddress":"http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion","bridgeMode":"snowflake"}"#,
        );
        assert_eq!(
            tor_ready,
            ParsedSidecarEvent::TorReady {
                onion_address: "http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion".to_string(),
            }
        );

        let tunnel_ready = parse_sidecar_event_line(
            r#"{"event":"tunnel_ready","provider":"cloudflare","publicOrigin":"https://demo.trycloudflare.com"}"#,
        );
        assert_eq!(
            tunnel_ready,
            ParsedSidecarEvent::TunnelReady {
                public_origin: "https://demo.trycloudflare.com".to_string(),
            }
        );

        assert_eq!(
            parse_sidecar_event_line(r#"{"event":"stopped","purgedDataDir":true}"#),
            ParsedSidecarEvent::Stopped
        );
    }

    #[test]
    fn browser_url_allowlist_permits_only_loopback_http_and_https() {
        assert!(is_allowed_browser_url("http://127.0.0.1:41234"));
        assert!(is_allowed_browser_url("http://127.0.0.1:8080/"));
        assert!(is_allowed_browser_url("https://github.com/pulso-app/pulso/releases"));
        assert!(!is_allowed_browser_url("file:///etc/passwd"));
        assert!(!is_allowed_browser_url("javascript:alert(1)"));
        assert!(!is_allowed_browser_url("http://192.168.1.10:3000"));
        assert!(!is_allowed_browser_url("http://127.0.0.1:0"));
    }
}
