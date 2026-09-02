//! DeadWax core. Windows-only by construction: the whole ingest premise is
//! SMTC, which does not exist anywhere else.

pub mod art;
pub mod capture;
pub mod press;
pub mod resolve;
pub mod runtime;
pub mod serve;
pub mod store;
pub mod tracker;

/// One timestamp format everywhere, round-trippable, with the offset kept.
/// Local time matters here -- "what was I listening to on Tuesday evening" is a
/// question about the listener's clock, not UTC.
pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}
