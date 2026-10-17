# Optional reverse proxy

The frontend container currently serves static assets and proxies `/api` only to gateway. An external nginx/ingress deployment can provide TLS and route the same two paths: `/` to frontend and `/api/` to gateway. Do not expose model or database endpoints through the public web origin. No additional proxy container is needed for the local 15-container stack.
