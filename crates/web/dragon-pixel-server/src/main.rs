// SPDX-License-Identifier: Apache-2.0
use std::{env, error::Error};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let address = env::var("DRAGON_PIXEL_BIND").unwrap_or_else(|_| "127.0.0.1:4320".to_owned());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("Dragon Pixel multiplayer: ws://{address}/ws/{{room}}");
    axum::serve(listener, aphrody_web_game_server::router()).await?;
    Ok(())
}
