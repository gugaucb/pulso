use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_ID: &str = "pulso-tray";
pub const TRAY_MENU_OPEN_ROOM: &str = "open_room";
pub const TRAY_MENU_SHOW_PANEL: &str = "show_panel";
pub const TRAY_MENU_QUIT_AND_PURGE: &str = "quit_and_purge";

pub fn setup_tray<FOpen, FQuit>(
    app: &AppHandle,
    product_name: &str,
    on_open_room: FOpen,
    on_quit_and_purge: FQuit,
) -> tauri::Result<()>
where
    FOpen: Fn(&AppHandle) + Send + Sync + 'static,
    FQuit: Fn(&AppHandle) + Send + Sync + 'static,
{
    let open_item = MenuItemBuilder::with_id(TRAY_MENU_OPEN_ROOM, "Abrir Sala no navegador")
        .build(app)?;
    let show_item = MenuItemBuilder::with_id(TRAY_MENU_SHOW_PANEL, "Mostrar painel")
        .build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_MENU_QUIT_AND_PURGE, "Encerrar e purgar rastro")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&open_item, &show_item, &quit_item])
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(product_name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            TRAY_MENU_OPEN_ROOM => on_open_room(app),
            TRAY_MENU_SHOW_PANEL => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            TRAY_MENU_QUIT_AND_PURGE => on_quit_and_purge(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn notify_minimized_to_tray(app: &AppHandle) {
    let _ = app.emit(
        "pulso://lifecycle-event",
        serde_json::json!({ "event": "window_minimized_to_tray" }),
    );
}
