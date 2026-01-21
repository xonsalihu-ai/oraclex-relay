const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Simple in-memory storage
let marketState = { symbols: {}, analysis: {}, timestamp: null };

// ENDPOINTS
app.get('/', (req, res) => {
  res.json({ status: 'OK', relay: 'V2.2', uptime: process.uptime() });
});

app.get('/status', (req, res) => {
  const symbolCount = Object.keys(marketState.symbols).length;
  const analysisCount = Object.keys(marketState.analysis).length;
  res.json({ 
    status: 'running', 
    symbols: symbolCount,
    analysis: analysisCount,
    timestamp: marketState.timestamp 
  });
});

// Receive market data from EA
app.post('/update-market-state', async (req, res) => {
  try {
    const { market_data } = req.body;
    
    if (!market_data || !Array.isArray(market_data)) {
      return res.json({ error: 'Invalid data' });
    }

    // Store market data in memory
    for (const sym of market_data) {
      const symbol = sym.symbol;
      if (symbol) {
        marketState.symbols[symbol] = sym;
      }
    }
    marketState.timestamp = Date.now();

    console.log(`✅ Relay stored ${market_data.length} symbols. Total: ${Object.keys(marketState.symbols).length}`);

    // Forward to Python on Railway internal network
    console.log(`📤 Forwarding ${market_data.length} symbols to Python...`);
    
    try {
      // Use Railway internal network hostname
      const pythonUrl = process.env.PYTHON_INTERNAL_URL || 'http://oraclex-python-backend.railway.internal:8080';
      
      console.log(`   Connecting to: ${pythonUrl}/market-data-v1.6`);
      
      const pythonResp = await fetch(`${pythonUrl}/market-data-v1.6`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          server_time: Math.floor(Date.now() / 1000), 
          market_data 
        }),
        timeout: 10000
      });

      console.log(`   Response status: ${pythonResp.status}`);

      if (pythonResp.ok) {
        const pythonData = await pythonResp.json();
        console.log(`✅ Python accepted data - stored: ${pythonData.stored}`);
      } else {
        console.warn(`⚠️ Python returned ${pythonResp.status}`);
      }
    } catch (pythonErr) {
      console.warn(`⚠️ Python connection error: ${pythonErr.message}`);
      console.warn(`   Error type: ${pythonErr.name}`);
    }

    res.json({ 
      success: true, 
      symbols_stored: market_data.length, 
      total_symbols: Object.keys(marketState.symbols).length 
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get market state for dashboard (market data only)
app.get('/get-market-state', (req, res) => {
  const symbols = Object.values(marketState.symbols);
  res.json({ 
    market_data: symbols, 
    timestamp: marketState.timestamp,
    total_symbols: symbols.length
  });
});

// Proxy to Python analysis endpoint
app.get('/analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    const pythonUrl = process.env.PYTHON_INTERNAL_URL || 'http://oraclex-python-backend.railway.internal:8080';
    
    const pythonResp = await fetch(`${pythonUrl}/analysis/${symbol}`, {
      timeout: 10000
    });
    
    if (pythonResp.ok) {
      const analysis = await pythonResp.json();
      res.json(analysis);
    } else {
      res.status(pythonResp.status).json({ error: 'Analysis not available' });
    }
  } catch (error) {
    console.error(`Analysis proxy error for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all analysis
app.get('/latest-analysis', async (req, res) => {
  try {
    const pythonUrl = process.env.PYTHON_INTERNAL_URL || 'http://oraclex-python-backend.railway.internal:8080';
    
    const pythonResp = await fetch(`${pythonUrl}/latest-analysis`, {
      timeout: 15000
    });
    
    if (pythonResp.ok) {
      const data = await pythonResp.json();
      res.json(data);
    } else {
      res.status(pythonResp.status).json({ analyses: [] });
    }
  } catch (error) {
    console.error('Latest analysis proxy error:', error.message);
    res.status(500).json({ analyses: [], error: error.message });
  }
});

// Start server
console.log('\n' + '='.repeat(80));
console.log('✨ ORACLEX RELAY V2.2');
console.log('='.repeat(80));
console.log(`🚀 Listening on port ${PORT}`);
console.log(`📡 Python Backend URL: ${process.env.PYTHON_INTERNAL_URL || 'http://oraclex-python-backend.railway.internal:8080'}`);
console.log('='.repeat(80));
console.log('\nFeatures:');
console.log('  ✓ Receives market data from EA');
console.log('  ✓ Stores market state');
console.log('  ✓ Forwards to Python (internal Railway network)');
console.log('  ✓ Proxies analysis endpoints');
console.log('  ✓ Returns combined data to Dashboard');
console.log('='.repeat(80) + '\n');

app.listen(PORT, '0.0.0.0');
