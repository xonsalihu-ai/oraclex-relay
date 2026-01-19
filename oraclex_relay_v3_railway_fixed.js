#!/usr/bin/env node

/**
 * ORACLEX RELAY V2.0 - UPDATED FOR PYTHON INTEGRATION + V2.4 DASHBOARD
 * 
 * Based on proven working code
 * - Added V2.4 dashboard features to /market-analysis
 * - Keep backward compatibility with all endpoints
 * - Uses Express.js
 * - Runs on port 3000 (or $PORT env var)
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// State
let marketState = {
  market_data: [],
  timestamp: null,
  data_age_sec: 0
};

let commandQueue = [];
let pendingApprovals = new Map();
let activeTrades = [];
let receipts = [];

// Helpers
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sendTelegramMessage(text) {
  console.log(`📨 Telegram would send: ${text.substring(0, 50)}...`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GET ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    name: 'OracleX Trading Relay',
    version: '2.0',
    uptime: process.uptime()
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  const dataAge = marketState.timestamp 
    ? Math.floor((Date.now() - marketState.timestamp) / 1000)
    : null;
  
  res.json({
    status: 'running',
    relay_active: true,
    symbols_count: marketState.market_data?.length || 0,
    trades_open: activeTrades.length,
    pending_approvals: pendingApprovals.size,
    queue_size: commandQueue.length,
    last_update: marketState.timestamp,
    data_age_sec: dataAge,
    timestamp: new Date().toISOString()
  });
});

// Get market state (for Dashboard)
app.get('/get-market-state', (req, res) => {
  const dataAge = marketState.timestamp 
    ? Math.floor((Date.now() - marketState.timestamp) / 1000)
    : 0;
  
  res.json({
    ...marketState,
    data_age_sec: dataAge
  });
});

// Get pending approvals
app.get('/pending-approvals', (req, res) => {
  const items = Array.from(pendingApprovals.entries()).map(([cmdId, pending]) => ({
    cmd_id: cmdId,
    symbol: pending.signal?.symbol,
    action: pending.signal?.action,
    status: pending.status,
    created_at: pending.created_at,
    auto_approve_in_sec: Math.max(0, 30 - (nowSec() - pending.created_at))
  }));
  
  res.json({
    total: items.length,
    items
  });
});

// Get last signal for MT5
app.get('/last-signal', (req, res) => {
  if (commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    console.log(`📤 TO MT5: ${cmd.symbol} ${cmd.action} lot=${cmd.lot}`);
    res.json(cmd);
  } else {
    res.json({ action: 'NONE' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// NEW ENDPOINT: /update-market-state (from MQL5)
app.post('/update-market-state', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.status(400).json({ error: 'Invalid market_data format' });
    }

    if (!marketState.market_data) {
      marketState.market_data = [];
    }
    
    // Update only the symbols that are in this batch
    market_data.forEach(newSymbol => {
      const existingIndex = marketState.market_data.findIndex(
        s => s.symbol === newSymbol.symbol
      );
      
      if (existingIndex >= 0) {
        // MERGE: Update existing symbol with new data
        marketState.market_data[existingIndex] = {
          ...marketState.market_data[existingIndex],
          ...newSymbol,
          indicators: newSymbol.indicators || marketState.market_data[existingIndex].indicators
        };
      } else {
        marketState.market_data.push(newSymbol);
      }
    });

    marketState.timestamp = Date.now();

    const symbolCount = marketState.market_data.length;
    if (symbolCount > 0) {
      const firstSymbol = marketState.market_data[0];
      const greenCount = Object.values(firstSymbol.indicators || {})
        .filter(ind => ind && ind[0] === '🟢').length;
      console.log(`✅ Market state merged: ${symbolCount} symbols | First: ${firstSymbol.symbol} (${greenCount} green)`);
    }

    res.json({
      success: true,
      message: 'Market state merged',
      symbols_merged: symbolCount
    });
  } catch (error) {
    console.error('❌ Error updating market state:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// LEGACY: /data-update (for backward compatibility)
app.post('/data-update', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (market_data && Array.isArray(market_data)) {
      marketState = {
        market_data,
        timestamp: Date.now(),
        data_age_sec: 0
      };
    }
    
    res.json({ ok: true, message: 'Data received' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATED: /market-analysis (with V2.4 dashboard features)
app.post('/market-analysis', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (market_data && Array.isArray(market_data)) {
      // Merge with existing data
      market_data.forEach(sym => {
        const existing = marketState.market_data?.find(m => m.symbol === sym.symbol);
        if (existing) {
          // Merge analysis data
          existing.indicators = sym.indicators || existing.indicators;
          existing.bias = sym.bias || existing.bias;
          existing.insight = sym.insight || existing.insight;
          existing.strategies = sym.strategies || existing.strategies;
          existing.confluence = sym.confluence || existing.confluence;
          existing.green_count = sym.green_count ?? existing.green_count;
          
          // NEW V2.4 Dashboard Features
          existing.market_regime = sym.market_regime || existing.market_regime;
          existing.bias_stability = sym.bias_stability || existing.bias_stability;
          existing.confluence_breakdown = sym.confluence_breakdown || existing.confluence_breakdown;
          existing.context_history = sym.context_history || existing.context_history;
          existing.state_statistics = sym.state_statistics || existing.state_statistics;
          existing.current_session = sym.current_session || existing.current_session;
          existing.session_intelligence = sym.session_intelligence || existing.session_intelligence;
          existing.confidence = sym.confidence ?? existing.confidence;
        }
      });
      
      marketState.timestamp = Date.now();
      
      if (market_data.length > 0) {
        const sym = market_data[0];
        const greenCount = Object.values(sym.indicators || {})
          .filter(ind => ind && ind[0] === '🟢').length;
        console.log(`📊 Analysis: ${sym.symbol} - ${greenCount}/${Object.keys(sym.indicators || {}).length} indicators | Regime: ${sym.market_regime?.trend || 'Unknown'}`);
      }
    }
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit signal for approval
app.post('/submit-signal', (req, res) => {
  try {
    const signal = req.body;
    
    if (!signal.symbol || !signal.action) {
      return res.status(400).json({ error: 'Missing symbol or action' });
    }

    const cmdId = signal.cmd_id || `OX_${Date.now()}`;
    const greenCount = signal.green_count || 0;

    console.log(`🚨 SIGNAL RECEIVED: ${signal.symbol} ${signal.action} (${greenCount}/7 green)`);

    // Store as pending
    pendingApprovals.set(cmdId, {
      signal,
      status: 'PENDING',
      created_at: nowSec()
    });

    // Send Telegram (if configured)
    const telegramMsg = `
🚨 ${signal.symbol} ${signal.action}
🤖 Confidence: ${signal.confidence || 0}%
📊 ${greenCount}/7 indicators
Entry: ${signal.entry?.toFixed(5)}
SL: ${signal.sl?.toFixed(5)}
TP: ${signal.tp?.toFixed(5)}
    `.trim();
    
    sendTelegramMessage(telegramMsg);

    res.json({
      status: 'PENDING_APPROVAL',
      cmd_id: cmdId,
      auto_approve_in_sec: 30
    });
  } catch (error) {
    console.error('❌ Error submitting signal:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Approve signal manually
app.post('/approve-signal', (req, res) => {
  try {
    const { cmd_id, lot } = req.body;
    const pending = pendingApprovals.get(cmd_id);
    
    if (pending) {
      pending.status = 'APPROVED';
      
      // Queue for MT5
      const queueSignal = {
        cmd_id,
        symbol: pending.signal.symbol,
        action: pending.signal.action,
        lot: lot || pending.signal.lot || 0.1,
        sl: pending.signal.sl,
        tp: pending.signal.tp,
        price: pending.signal.price
      };
      
      commandQueue.push(queueSignal);
      console.log(`✅ APPROVED: ${cmd_id} lot=${queueSignal.lot}`);
    }
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execution receipt from MT5
app.post('/execution-receipt', (req, res) => {
  try {
    const receipt = req.body;
    receipts.push(receipt);
    
    if (receipt.cmd_id) {
      pendingApprovals.delete(receipt.cmd_id);
    }
    
    console.log(`🧾 EXECUTION: ${receipt.symbol} ${receipt.action} retcode=${receipt.retcode}`);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Flush command queue
app.post('/flush-queue', (req, res) => {
  commandQueue = [];
  res.json({ status: 'FLUSHED' });
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║        🚀 ORACLEX RELAY V2.0 - PRODUCTION READY 🚀           ║
║                    + V2.4 DASHBOARD FEATURES                  ║
╚════════════════════════════════════════════════════════════════╝

✅ Server listening on port ${PORT}

📡 ENDPOINTS:
  GET  /                    → Health check
  GET  /status              → System status
  GET  /get-market-state    → Market data (for Dashboard)
  GET  /pending-approvals   → Waiting signals
  GET  /last-signal         → Next signal for MT5
  
  POST /update-market-state ← MQL5 sends here
  POST /data-update         ← MT5 sends here (legacy)
  POST /market-analysis     ← Python sends analysis + V2.4 features
  POST /submit-signal       ← Trade signals
  POST /approve-signal      ← Manual approval
  POST /execution-receipt   ← MT5 confirmations

🔗 CONNECTION FLOW:
  MQL5 → /update-market-state (price data)
  Python → /market-analysis (analysis + dashboard features)
  Dashboard → /get-market-state (complete data)

✅ System ready with V2.4 dashboard features!
  `);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
