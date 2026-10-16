use serde_derive::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestMismatchMitigationStrategy {
  /// Upgrade the request to pay more.
  PayMoreUpgrade,
  
  /// Downgrade the request to pay less
  PayLessDowngrade,
  
  /// Fail the request.
  ErrorOut,
}
