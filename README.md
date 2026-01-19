# OracleX Relay - Railway Deployment

## Files Included

- `oraclex_relay_v2_updated.js` - Main relay server with V2.4 dashboard features
- `package.json` - Node.js dependencies (express, cors, body-parser)
- `Procfile` - Railway configuration

## How to Deploy

1. Delete everything in your GitHub repo
2. Upload these files to GitHub
3. Railway will auto-detect and deploy
4. Service will restart automatically

## Endpoints

- `GET /` - Health check
- `GET /status` - System status
- `GET /get-market-state` - Dashboard data
- `POST /update-market-state` - MQL5 sends data here
- `POST /market-analysis` - Python sends analysis here

## Ready to Go!

No configuration needed. Just upload and Railway handles the rest.
