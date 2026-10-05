# HTTP/1.1 keep-alive proxying with Host and scheme forwarded.
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
