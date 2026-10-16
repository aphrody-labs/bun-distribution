# Replace client-supplied identity headers; only the tunnel map may set a user.
proxy_set_header X-WEBAUTH-USER "";
proxy_set_header X-WEBAUTH-EMAIL "";
proxy_set_header X-WEBAUTH-FULLNAME "";
proxy_set_header X-Aphrody-Tunnel-User $aphrody_source_tunnel_user;
proxy_set_header X-Forwarded-For $remote_addr;
