//! DeadWax. The desktop app.
//!
//! The window is created at runtime rather than declared in `tauri.conf.json`,
//! because it points at the in-process loopback server whose port is not known
//! until it binds. That server hands the WebView the repo's real `index.html`
//! with the shelf injected -- see `serve.rs` for why the page is served rather
//! than bundled.
//!
//! Everything that is not the window lives in `runtime`, shared with the
//! headless build so the two cannot drift.

// No console, ever -- not even in debug. `not(debug_assertions)` used to guard
// this, which meant every development run threw a black console window up
// behind the app. Stdout for debugging belongs to `--bin app`, which is
// headless on purpose; this binary is the product and the product has one
// window.
#![windows_subsystem = "windows"]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let verbose = cfg!(debug_assertions);

    let (state, port) = match deadwax::runtime::start(verbose) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("DeadWax could not start: {e}");
            std::process::exit(1);
        }
    };
    deadwax::runtime::spawn_capture(state, verbose);

    let url = format!("http://127.0.0.1:{port}/");
    let parsed = url.parse().expect("loopback url must parse");

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("DeadWax")
                .inner_size(1280.0, 820.0)
                .min_inner_size(880.0, 620.0)
                // The page paints its own near-black ground. Matching it here
                // stops a white flash between the window opening and the first
                // frame -- on a product whose whole surface is a dark room, a
                // white flash on every launch is the first thing you notice.
                .background_color(tauri::window::Color(10, 10, 10, 255))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DeadWax");
}
