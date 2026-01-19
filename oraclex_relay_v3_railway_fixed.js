#!/usr/bin/env node

/**
 * ORACLEX RELAY V3.0 - RAILWAY PRODUCTION
 * 
 * Fixed for Railway deployment
 * - Uses only Express built-in middleware
 * - No external dependencies except express
 * - Merges MQL5 + Python data
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - using built-in express methods
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS headers manually
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// State
let marketState = {
  market_data: [],
  timestamp: null
};

let dashboardCache = new Map();
let commandQueue = [];
let pendingApprovals = new Map();
let receipts = [];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function mergeSymbolData(mql5Data, pythonData) {
  const symbol = mql5Data.symbol || 'UNKNOWN';
  
  return {
    // MQL5 Price Data
    symbol: symbol,
    price: mql5Data.price || mql5Data.ask || 0,
    bid: mql5Data.bid || 0,
    ask: mql5Data.ask || 0,
    price_change_1h: mql5Data.price_change_1h || 0,
    h1_high: mql5Data.h1_high || 0,
    h1_low: mql5Data.h1_low || 0,
    m5_high: mql5Data.m5_high || 0,
    m5_low: mql5Data.m5_low || 0,
    spread_points: mql5Data.spread_points || 0,
    
    // Python Analysis Data
    bias: pythonData?.bias || 'NEUTRAL',
    green_count: pythonData?.green_count || 0,
    confidence: pythonData?.confidence || 0,
    insight: pythonData?.insight || 'Analyzing...',
    indicators: pythonData?.indicators || {},
    
    // V2.4 Dashboard Features
    market_regime: pythonData?.market_regime || {
      trend: 'Unknown',
      volatility: 'Normal',
      structure: 'Choppy'
    },
    
    bias_stability: pythonData?.bias_stability || {
      active_since_minutes: 0,
      last_flip_minutes_ago: null
    },
    
    confluence_breakdown: pythonData?.confluence_breakdown || {
      ema_trend: { active: 0, weight: 40, name: 'EMA Trend' },
      momentum: { active: 0, weight: 30, name: 'Momentum' },
      structure: { active: 0, weight: 20, name: 'Structure' },
      filters: { active: 0, weight: 10, name: 'Filters' }
    },
    
    context_history: pythonData?.context_history || [],
    state_statistics: pythonData?.state_statistics || {},
    current_session: pythonData?.current_session || 'Unknown',
    session_intelligence: pythonData?.session_intelligence || {},
    
    strategies: pythonData?.strategies || [],
    confluence: pythonData?.confluence || {},
    
    // OHLCV from MQL5
    ohlcv_micro: mql5Data.ohlcv_micro || [],
    ohlcv_macro: mql5Data.ohlcv_macro || [],
    open_trades: mql5Data.open_trades || [],
    pending_orders: mql5Data.pending_orders || []
  };
}

function getCompleteMarketState() {
  const completeData = marketState.market_data.map(mql5Symbol => {
    const pythonData = dashboardCache.get(mql5Symbol.symbol);
    return mergeSymbolData(mql5Symbol, pythonData);
  });
  
  return {
    market_data: completeData,
    timestamp: marketState.timestamp,
    data_age_sec: marketState.timestamp 
      ? Math.floor((Date.now() - marketState.timestamp) / 1000)
      : 0,
    symbols_count: completeData.length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    name: 'OracleX Trading Relay',
    version: '3.0',
    uptime: Math.floor(process.uptime()),
    deployed: 'Railway',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

app.get('/status', (req, res) => {
  const dataAge = marketState.timestamp 
    ? Math.floor((Date.now() - marketState.timestamp) / 1000)
    : null;
  
  res.json({
    status: 'running',
    relay_active: true,
    symbols_count: marketState.market_data?.length || 0,
    cache_size: dashboardCache.size,
    queue_size: commandQueue.length,
    pending_approvals: pendingApprovals.size,
    last_update: marketState.timestamp ? new Date(marketState.timestamp).toISOString() : null,
    data_age_sec: dataAge,
    timestamp: new Date().toISOString()
  });
});

app.get('/get-market-state', (req, res) => {
  const completeState = getCompleteMarketState();
  res.json(completeState);
});

app.get('/pending-approvals', (req, res) => {
  const items = Array.from(pendingApprovals.entries()).map(([cmdId, pending]) => ({
    cmd_id: cmdId,
    symbol: pending.signal?.symbol,
    action: pending.signal?.action,
    status: pending.status,
    created_at: pending.created_at
  }));
  
  res.json({
    total: items.length,
    items: items
  });
});

app.get('/last-signal', (req, res) => {
  if (commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    console.log(`📤 Signal sent to MT5: ${cmd.symbol} ${cmd.action}`);
    res.json(cmd);
  } else {
    res.json({ action: 'NONE' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/update-market-state', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.status(400).json({ error: 'Invalid market_data format' });
    }

    if (!marketState.market_data) {
      marketState.market_data = [];
    }
    
    // Merge with existing data
    market_data.forEach(newSymbol => {
      const existingIndex = marketState.market_data.findIndex(
        s => s.symbol === newSymbol.symbol
      );
      
      if (existingIndex >= 0) {
        // Update existing
        marketState.market_data[existingIndex] = {
          ...marketState.market_data[existingIndex],
          ...newSymbol
        };
      } else {
        // Add new
        marketState.market_data.push(newSymbol);
      }
    });

    marketState.timestamp = Date.now();

    const symbolCount = marketState.market_data.length;
    console.log(`✅ MQL5 data received: ${symbolCount} symbols merged`);

    res.json({
      success: true,
      message: 'Market state updated',
      symbols_merged: symbolCount
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/market-analysis', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.status(400).json({ error: 'Invalid market_data format' });
    }

    // Cache Python analysis data
    market_data.forEach(symbolData => {
      if (symbolData.symbol) {
        dashboardCache.set(symbolData.symbol, {
          bias: symbolData.bias,
          green_count: symbolData.green_count,
          confidence: symbolData.confidence,
          insight: symbolData.insight,
          indicators: symbolData.indicators,
          
          // V2.4 Features
          market_regime: symbolData.market_regime,
          bias_stability: symbolData.bias_stability,
          confluence_breakdown: symbolData.confluence_breakdown,
          context_history: symbolData.context_history,
          state_statistics: symbolData.state_statistics,
          current_session: symbolData.current_session,
          session_intelligence: symbolData.session_intelligence,
          
          strategies: symbolData.strategies,
          confluence: symbolData.confluence,
          last_update: Date.now()
        });
      }
    });

    if (marketState.timestamp === null) {
      marketState.timestamp = Date.now();
    }

    console.log(`📊 Python analysis cached: ${market_data.length} symbols`);

    res.json({
      success: true,
      message: 'Analysis data cached',
      symbols_cached: market_data.length
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/submit-signal', (req, res) => {
  try {
    const signal = req.body;
    
    if (!signal.symbol || !signal.action) {
      return res.status(400).json({ error: 'Missing symbol or action' });
    }

    const cmdId = signal.cmd_id || `OX_${Date.now()}`;
    
    pendingApprovals.set(cmdId, {
      signal: signal,
      status: 'PENDING',
      created_at: Math.floor(Date.now() / 1000)
    });

    console.log(`🚨 Signal received: ${signal.symbol} ${signal.action}`);

    res.json({
      status: 'PENDING_APPROVAL',
      cmd_id: cmdId,
      auto_approve_in_sec: 30
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/approve-signal', (req, res) => {
  try {
    const { cmd_id, lot } = req.body;
    const pending = pendingApprovals.get(cmd_id);
    
    if (pending) {
      pending.status = 'APPROVED';
      
      const queueSignal = {
        cmd_id: cmd_id,
        symbol: pending.signal.symbol,
        action: pending.signal.action,
        lot: lot || pending.signal.lot || 0.1,
        sl: pending.signal.sl,
        tp: pending.signal.tp,
        price: pending.signal.price,
        comment: pending.signal.comment || 'ORACLEX'
      };
      
      commandQueue.push(queueSignal);
      console.log(`✅ Signal approved: ${cmd_id}`);
    }
    
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/execution-receipt', (req, res) => {
  try {
    const receipt = req.body;
    receipts.push(receipt);
    
    if (receipt.cmd_id) {
      pendingApprovals.delete(receipt.cmd_id);
    }
    
    console.log(`🧾 Execution receipt: ${receipt.symbol} ${receipt.action}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/data-update', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (market_data && Array.isArray(market_data)) {
      marketState = {
        market_data: market_data,
        timestamp: Date.now()
      };
    }
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/flush-queue', (req, res) => {
  commandQueue = [];
  res.json({ status: 'FLUSHED', ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ error: err.message });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║     🚀 ORACLEX RELAY V3.0 - RAILWAY PRODUCTION 🚀             ║
╚════════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
✅ Deployed on Railway
✅ CORS enabled
✅ Dashboard features active

📡 ENDPOINTS:
  GET  /                    → Health check
  GET  /health              → Healthcheck
  GET  /status              → System status
  GET  /get-market-state    → Dashboard data
  GET  /pending-approvals   → Pending signals
  GET  /last-signal         → Signal for MT5
  
  POST /update-market-state ← MQL5 sends here
  POST /market-analysis     ← Python sends here
  POST /submit-signal       ← Trade signals
  POST /approve-signal      ← Approve trade
  POST /execution-receipt   ← MT5 confirmation
  POST /flush-queue         ← Clear queue

✅ Ready to receive data from MQL5 and Python!
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n👋 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
