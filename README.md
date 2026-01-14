# 🚀 OracleX Trading Relay Server

High-performance relay server for OracleX trading system.

## How It Works

```
Python (Trading Logic)
    ↓
    ├─→ POST /update-market-state
    │
Node.js Relay (This Server)
    ↓
    ├─→ GET /get-market-state
    │
Dashboard (Browser)
    ↓
You (Making Trading Decisions)
```

## Features

✓ Receives data from Python trading system
✓ Stores market data and indicators
✓ Broadcasts to dashboard via REST API
✓ CORS enabled for cross-origin requests
✓ Health check endpoints
✓ Real-time data updates

## Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | API info |
| GET | `/health` | Health check |
| GET | `/status` | Server status |
| POST | `/update-market-state` | Receive data from Python |
| GET | `/get-market-state` | Send data to Dashboard |

## Quick Start

### Local Development

```bash
npm install
npm run dev
```

### Production (Railway)

Railway automatically detects and deploys based on:
- `package.json` (dependencies)
- `Procfile` (start command)
- `oraclex_relay_enhanced.js` (main file)

## Environment Variables

None required for basic setup.

Optional:
- `PORT` (default: 3000)
- `NODE_ENV` (development/production)

## API Examples

### Send Data (from Python)

```bash
curl -X POST http://localhost:3000/update-market-state \
  -H "Content-Type: application/json" \
  -d '{
    "market_data": [
      {
        "symbol": "XAUUSD",
        "indicators": { "RSI": ["🟢", "65", "bullish"] },
        "strategies": []
      }
    ]
  }'
```

### Get Data (from Dashboard)

```bash
curl http://localhost:3000/get-market-state
```

## Troubleshooting

### Port Already in Use
```bash
# Find process on port 3000
lsof -i :3000
# Kill it
kill -9 <PID>
```

### CORS Errors
- Make sure `cors()` middleware is enabled
- Check dashboard URL is allowed

### Data Not Updating
- Check Python is sending POST requests
- Check Python has correct relay URL
- View Railway logs for errors

## Deployment

Deployed on Railway.app

- Auto-deploys on GitHub push
- Check logs: Railway Dashboard → Logs tab
- Restart: Railway Dashboard → Deploy → Redeploy

## Support

For issues or questions, check:
1. Railway logs (errors)
2. Python console (is it sending data?)
3. Dashboard console (F12, check for errors)

---

**Version:** 1.0.0  
**Last Updated:** 2025-01-14
