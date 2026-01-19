#!/usr/bin/env node

/**
 * ORACLEX RELAY V3.0 - COMPLETE DASHBOARD INTEGRATION
 * 
 * KEY FEATURES:
 * - Merges MQL5 price data with Python analysis
 * - Serves complete dashboard payload via /get-market-state
 * - Includes: Market Regime, Bias Stability, Confluence Breakdown, 
 *   Context History, State Statistics, Session Intelligence
 * - Real-time data streaming with proper caching
 * - Full backward compatibility
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

// State - Enhanced structure
let marketState = {
  market_data: [],
  timestamp: null,
  data_age_sec: 0
};

// Cache for dashboard features from Python
let dashboardCache = new Map(); // symbol -> { market_regime, bias_stability, etc }

let commandQueue = [];
let pendingApprovals = new Map();
let activeTrades = [];
let receipts = [];

// Helpers
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sendTelegramMessage(text) {
  console.log(`📨 Telegram: ${text.substring(0, 50)}...`);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge MQL5 price data with Python analysis data
 * Creates complete dashboard payload
 */
function mergeSymbolData(mql5Data, pythonData) {
  const symbol = mql5Data.symbol;
  
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
    
    // NEW V2.4 FEATURES
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
    
    state_statistics: pythonData?.state_statistics || {
      continuation: 50,
      reversal: 25,
      consolidation: 25,
      best_session: 'Unknown'
    },
    
    current_session: pythonData?.current_session || 'Unknown',
    session_intelligence: pythonData?.session_intelligence || {
      volatility: 'Medium',
      best_setup: 'Mixed'
    },
    
    // Strategies & Confluence
    strategies: pythonData?.strategies || [],
    confluence: pythonData?.confluence || { total: 0, consensus: '0/4' },
    
    // MQL5 Technical Details
    digits: mql5Data.digits || 5,
    ohlcv_micro: mql5Data.ohlcv_micro || [],
    ohlcv_macro: mql5Data.ohlcv_macro || [],
    open_trades: mql5Data.open_trades || [],
    pending_orders: mql5Data.pending_orders || [],
    
    // Metadata
    last_update_mql5: mql5Data.last_update || null,
    last_update_python: pythonData?.last_update || null,
    data_source: 'merged'
  };
}

/**
 * Get complete market state with all dashboard features
 */
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
    symbols_count: completeData.length,
    last_update: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    name: 'OracleX Trading Relay',
    version: '3.0',
    uptime: process.uptime(),
    features: [
      'Market Regime Classification',
      'Bias Stability Tracking',
      'Confluence Weight Breakdown',
      'Context History (60 min)',
      'State-Based Statistics',
      'Session Intelligence',
      'Real-time Dashboard Streaming'
    ]
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
    dashboard_cache_size: dashboardCache.size,
    trades_open: activeTrades.length,
    pending_approvals: pendingApprovals.size,
    queue_size: commandQueue.length,
    last_update: marketState.timestamp,
    data_age_sec: dataAge,
    timestamp: new Date().toISOString()
  });
});

/**
 * MAIN ENDPOINT: Get complete market state with ALL dashboard features
 * This is what the frontend calls!
 */
app.get('/get-market-state', (req, res) => {
  const completeState = getCompleteMarketState();
  res.json(completeState);
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

/**
 * UPDATED: /update-market-state (from MQL5)
 * Receives price data and merges with existing analysis
 */
app.post('/update-market-state', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.status(400).json({ error: 'Invalid market_data format' });
    }

    if (!marketState.market_data) {
      marketState.market_data = [];
    }
    
    // Update MQL5 price data
    market_data.forEach(newSymbol => {
      const existingIndex = marketState.market_data.findIndex(
        s => s.symbol === newSymbol.symbol
      );
      
      if (existingIndex >= 0) {
        // MERGE: Keep old analysis, update price
        marketState.market_data[existingIndex] = {
          ...marketState.market_data[existingIndex],
          ...newSymbol,
          // Preserve old indicators if not in new update
          indicators: newSymbol.indicators || marketState.market_data[existingIndex].indicators,
          ohlcv_micro: newSymbol.ohlcv_micro || marketState.market_data[existingIndex].ohlcv_micro,
          ohlcv_macro: newSymbol.ohlcv_macro || marketState.market_data[existingIndex].ohlcv_macro
        };
      } else {
        marketState.market_data.push(newSymbol);
      }
    });

    marketState.timestamp = Date.now();

    const symbolCount = marketState.market_data.length;
    if (symbolCount > 0) {
      console.log(`✅ MQL5 update: ${symbolCount} symbols merged`);
    }

    res.json({
      success: true,
      message: 'Market state updated',
      symbols_merged: symbolCount,
      dashboard_ready: symbolCount > 0
    });
  } catch (error) {
    console.error('❌ Error updating market state:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * NEW: /market-analysis (from Python with dashboard features)
 * Receives enriched analysis data and caches it
 */
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
          confluence: symbolData.confluence,
          strategies: symbolData.strategies,
          
          // NEW V2.4 Features
          market_regime: symbolData.market_regime,
          bias_stability: symbolData.bias_stability,
          confluence_breakdown: symbolData.confluence_breakdown,
          context_history: symbolData.context_history,
          state_statistics: symbolData.state_statistics,
          current_session: symbolData.current_session,
          session_intelligence: symbolData.session_intelligence,
          
          last_update: Date.now()
        });
      }
    });

    // Update timestamp
    if (marketState.timestamp === null) {
      marketState.timestamp = Date.now();
    }

    if (market_data.length > 0) {
      const sym = market_data[0];
      const greenCount = Object.values(sym.indicators || {})
        .filter(ind => ind && ind[0] === '🟢').length;
      console.log(`📊 Python analysis cached: ${sym.symbol} - ${greenCount} green, confidence ${sym.confidence}%`);
    }

    res.json({
      success: true,
      message: 'Dashboard features cached',
      symbols_cached: market_data.length
    });
  } catch (error) {
    console.error('❌ Error caching analysis:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// LEGACY: /data-update (for backward compatibility)
app.post('/data-update', (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (market_data && Array.isArray(market_data)) {
      // Route to update-market-state handler
      marketState = {
        market_data,
        timestamp: Date.now(),
        data_age_sec: 0
      };
    }
    
    res.json({ ok: true, message: 'Data received (legacy)' });
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

    console.log(`🚨 SIGNAL: ${signal.symbol} ${signal.action} (${greenCount}/7 green, ${signal.confidence}% confidence)`);

    // Store as pending
    pendingApprovals.set(cmdId, {
      signal,
      status: 'PENDING',
      created_at: nowSec()
    });

    // Send Telegram
    const telegramMsg = `
🚨 ${signal.symbol} ${signal.action}
🤖 Confidence: ${signal.confidence || 0}%
📊 ${greenCount}/7 indicators
Entry: ${signal.entry?.toFixed(5)}
SL: ${signal.sl?.toFixed(5)}
TP: ${signal.tp?.toFixed(5)}
Session: ${signal.current_session || 'Unknown'}
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
        price: pending.signal.price,
        comment: pending.signal.comment || 'ORACLEX'
      };
      
      commandQueue.push(queueSignal);
      console.log(`✅ APPROVED: ${cmd_id} | ${queueSignal.symbol} ${queueSignal.action} lot=${queueSignal.lot}`);
    }
    
    res.json({ ok: true, approved: true });
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
    
    const dashCtx = receipt.dashboard_context ? ` [${receipt.dashboard_context.market_regime_trend} ${receipt.dashboard_context.current_session}]` : '';
    console.log(`🧾 EXECUTION: ${receipt.symbol} ${receipt.action} retcode=${receipt.retcode}${dashCtx}`);
    
    res.json({ ok: true, receipt_id: receipt.cmd_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Flush command queue
app.post('/flush-queue', (req, res) => {
  commandQueue = [];
  res.json({ status: 'FLUSHED', ok: true });
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
╔═══════════════════════════════════════════════════════════════════════════╗
║              🚀 ORACLEX RELAY V3.0 - DASHBOARD READY 🚀                 ║
║                                                                           ║
║  ✨ NEW: Complete dashboard feature integration                          ║
║  ✨ NEW: Real-time market regime, bias stability, confluence breakdown   ║
║  ✨ NEW: Context history & state statistics                              ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

✅ Server listening on port ${PORT}

📡 KEY ENDPOINTS:
  
  GET  /get-market-state         → Complete dashboard payload ⭐
  GET  /status                   → System health & metrics
  GET  /pending-approvals        → Waiting trade signals
  GET  /last-signal              → Next signal for MT5
  
  POST /update-market-state      ← MQL5 sends price data
  POST /market-analysis          ← Python sends enriched analysis
  POST /submit-signal            ← Trade signals with dashboard context
  POST /approve-signal           ← Manual approval
  POST /execution-receipt        ← MT5 confirmations

🔗 DATA FLOW:
  
  MQL5 Executor
    ↓ (price + OHLCV data)
  /update-market-state
    ↓
  
  Python Backend (V2.4)
    ↓ (market regime + bias stability + confluence + etc)
  /market-analysis
    ↓
  
  Dashboard Cache (in memory)
    ↓ (merges both sources)
  
  Frontend requests /get-market-state
    ↓
  Returns COMPLETE payload with all features ✨

📊 DASHBOARD FEATURES SERVED:
  ✅ Market Regime (trend, volatility, structure)
  ✅ Bias Stability (active since, last flip)
  ✅ Confluence Breakdown (40/30/20/10 weights)
  ✅ Context History (60 min timeline)
  ✅ State-Based Statistics (continuation %, etc)
  ✅ Session Intelligence (Asia/London/NY)
  ✅ Technical Indicators (7 indicators)
  ✅ Price Data (bid/ask, spreads, OHLCV)

✅ System ready for dashboard deployment!
  `);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
