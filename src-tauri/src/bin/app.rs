//! The collector and the page, no window.
//!
//! Same runtime the desktop build uses, with the WebView left off so capture
//! and pressing can be watched in a terminal. Useful precisely when the window
//! is the thing being debugged.
//!
//!   cargo run --bin app

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (state, port) = deadwax::runtime::start(true)?;
    println!("\n  http://127.0.0.1:{port}\n");
    deadwax::runtime::capture_loop(state, true);
    Ok(())
}
