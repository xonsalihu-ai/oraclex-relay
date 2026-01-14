#!/usr/bin/env node
/**
 * ORACLEX RELAY V2.0 - UPDATED FOR PYTHON INTEGRATION
 * 
 * KEY CHANGES:
 * - Added /update-market-state endpoint (for Python)
 * - Keep backward compatibility with all old endpoints
 * - Uses Express.js for cleaner routing
 * - Better error handling and logging
 * - Runs on port 3000 (or SPORT env var)
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

// ═════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

let marketState = {
  market_data: [],
  timestamp: null,
  data_age_sec: 0
};

let commandQueue = [];
let pendingApprovals = new Map();
let activeSymbols = [];
let receipts = [];

// ═════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sendTelegramMessage(text) {
  // TODO: Implement Telegram console.log("📱 Telegram would send:", text);
}

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

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
  const dataAge = marketState.timestamp ? Math.floor((Date.now() - marketState.timestamp) / 1000) : null;
  res.json({
    status: 'running',
    relay_active: true,
    symbols_count: marketState.market_data?.length || 0,
    trades_open: activeSymbols.length,
    pending_approvals: pendingApprovals.size,
    queue_size: commandQueue.length,
    last_update: marketState.timestamp,
    data_age_sec: dataAge
  });
});

// Get market state (for Dashboard)
app.get('/get-market-state', (req, res) => {
  const dataAge = marketState.timestamp ? Math.floor((Date.now() - marketState.timestamp) / 1000) : null;
  res.json({
    market_data: marketState.market_data || [],
    timestamp: marketState.timestamp,
    data_age_sec: dataAge,
    symbols_count: marketState.market_data?.length || 0
  });
});

// Get pending approvals
app.get('/pending-approvals', (req, res) => {
  const items = Array.from(pendingApprovals.values());
  res.json({
    pending_count: items.length,
    items: items
  });
});

// Get last signal for MT5
app.get('/last-signal', (req, res) => {
  const signal = commandQueue.shift();
  res.json({
    signal: signal || 'NONE'
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// NEW ENDPOINT: /update-market-state (from Python)
// This is what the Python code sends!
app.post('/update-market-state', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.status(400).json({ error: 'Invalid market_data format' });
    }

    // 🔧 CRITICAL FIX: MERGE new data with existing, don't replace!
    // This prevents flickering when Python sends incomplete updates
    
    if (!marketState.market_data) {
      marketState.market_data = [];
    }
    
    // Update only the symbols that are in this batch
    market_data.forEach(newSymbol => {
      // Find if this symbol already exists
      const existingIndex = marketState.market_data.findIndex(
        s => s.symbol === newSymbol.symbol
      );
      
      if (existingIndex >= 0) {
        // MERGE: Update existing symbol with new data
        // Keep old data if not provided in new update
        marketState.market_data[existingIndex] = {
          ...marketState.market_data[existingIndex],
          ...newSymbol,
          // Preserve old indicators if not in new update
          indicators: newSymbol.indicators || marketState.market_data[existingIndex].indicators
        };
      } else {
        // New symbol, add it
        marketState.market_data.push(newSymbol);
      }
    });

    // Update timestamp
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

// Submit signal for approval
app.post('/submit-signal', (req, res) => {
  try {
    const signal = req.body;
    if (!signal.symbol || !signal.action) {
      return res.status(400).json({ error: 'Missing symbol or action' });
    }
    
    const cmdId = `SIG_${nowSec()}`;
    pendingApprovals.set(cmdId, {
      ...signal,
      status: 'PENDING',
      created_at: nowSec(),
      auto_approve_in_sec: 30
    });

    console.log(`📋 SIGNAL RECEIVED: ${signal.symbol} ${signal.action}`);
    console.log(`🤖 Confidence: ${signal.confidence}%`);
    console.log(`📌 Green count: ${signal.green_count}/7`);
    
    // Send Telegram (if configured)
    const telegramMsg = `🚨 ${signal.symbol} ${signal.action}
🤖 Confidence: ${signal.confidence}%
📊 Signals: ${signal.green_count}/7
Entry: ${signal.entry}
SL: ${signal.sl}
TP: ${signal.tp}`;
    
    sendTelegramMessage(telegramMsg);

    res.json({
      status: 'PENDING_APPROVAL',
      cmd_id: cmdId
    });
  } catch (error) {
    console.error('❌ Error submitting signal:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Approve signal manually
app.post('/approve-signal', (req, res) => {
  try {
    const { cmd_id } = req.body;
    const pending = pendingApprovals.get(cmd_id);
    
    if (!pending) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    
    pending.status = 'APPROVED';
    pending.approved_at = nowSec();
    
    // Add to command queue for MT5
    commandQueue.push({
      symbol: pending.symbol,
      action: pending.action,
      lot: pending.lot || 0.1,
      entry: pending.entry,
      sl: pending.sl,
      tp: pending.tp
    });

    console.log(`✅ SIGNAL APPROVED: ${pending.symbol}`);
    
    res.json({
      status: 'APPROVED',
      cmd_id: cmd_id
    });
  } catch (error) {
    console.error('❌ Error approving signal:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Execution receipt from MT5
app.post('/execution-receipt', (req, res) => {
  try {
    const receipt = req.body;
    receipts.push(receipt);
    
    if (receipt.status === 'SUCCESS') {
      activeSymbols.push(receipt.symbol);
      console.log(`📈 Trade opened: ${receipt.symbol}`);
    }
    
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error recording receipt:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS (Backward compatibility)
// ═════════════════════════════════════════════════════════════════════════════

// Legacy: /data-update (for backward compatibility)
app.post('/data-update', (req, res) => {
  try {
    const { market_data } = req.body;
    if (market_data && Array.isArray(market_data)) {
      marketState = { market_data, timestamp: Date.now() };
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Invalid format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy: /market-analysis (for backward compatibility)
app.post('/market-analysis', (req, res) => {
  try {
    const { market_data } = req.body;
    if (market_data && Array.isArray(market_data)) {
      marketState = { market_data, timestamp: Date.now() };
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Invalid format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('═'.repeat(80));
  console.log('🚀 ORACLEX RELAY V2.0 - STARTED');
  console.log('═'.repeat(80));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔗 Endpoints:`);
  console.log(`   GET  /              → Health check`);
  console.log(`   GET  /status        → System status`);
  console.log(`   GET  /get-market-state  → Dashboard data`);
  console.log(`   POST /update-market-state  → Python sends analysis`);
  console.log(`   POST /submit-signal → Trade signals`);
  console.log(`   POST /approve-signal → Manual approval`);
  console.log(`   POST /execution-receipt → MT5 confirmations`);
  console.log('═'.repeat(80));
});
