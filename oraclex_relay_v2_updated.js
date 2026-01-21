const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Python backend URL - now public!
const PYTHON_URL = process.env.PYTHON_URL || 'https://oraclex-python-backend-production.up.railway.app';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Simple in-memory storage
let marketState = { symbols: {}, analysis: {}, timestamp: null };

// Helper: Make HTTPS request to Python backend
async function forwardToPython(path, method, data) {
  try {
    const url = `${PYTHON_URL}${path}`;
    console.log(`[FETCH] ${method} ${url}`);
    
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 8000
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const responseText = await response.text();
    
    console.log(`[RESPONSE] Status: ${response.status}`);
    
    return {
      status: response.status,
      data: responseText
    };
  } catch (error) {
    console.error(`[FETCH ERROR] ${error.message}`);
    throw error;
  }
}

// ENDPOINTS
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    relay: 'V2.5', 
    uptime: process.uptime(),
    python_url: PYTHON_URL
  });
});

app.get('/status', (req, res) => {
  const symbolCount = Object.keys(marketState.symbols).length;
  const analysisCount = Object.keys(marketState.analysis).length;
  res.json({ 
    status: 'running', 
    symbols: symbolCount,
    analysis: analysisCount,
    timestamp: marketState.timestamp,
    python_url: PYTHON_URL
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

    // Forward to Python
    console.log(`📤 Forwarding ${market_data.length} symbols to Python...`);
    
    try {
      const pythonResponse = await forwardToPython(
        '/market-data-v1.6',
        'POST',
        { 
          server_time: Math.floor(Date.now() / 1000), 
          market_data 
        }
      );

      if (pythonResponse.status === 200) {
        console.log(`✅ Python accepted data`);
      } else {
        console.warn(`⚠️ Python returned ${pythonResponse.status}`);
      }
    } catch (pythonErr) {
      console.warn(`⚠️ Python forward error: ${pythonErr.message}`);
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

// Get market state for dashboard
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
    
    console.log(`📡 Proxying analysis for ${symbol}`);
    
    const pythonResponse = await forwardToPython(
      `/analysis/${symbol}`,
      'GET'
    );
    
    if (pythonResponse.status === 200) {
      const analysis = JSON.parse(pythonResponse.data);
      res.json(analysis);
    } else {
      res.status(pythonResponse.status).json({ error: 'Analysis not available' });
    }
  } catch (error) {
    console.error(`Analysis proxy error for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all analysis
app.get('/latest-analysis', async (req, res) => {
  try {
    console.log(`📡 Proxying latest-analysis`);
    
    const pythonResponse = await forwardToPython(
      '/latest-analysis',
      'GET'
    );
    
    if (pythonResponse.status === 200) {
      const data = JSON.parse(pythonResponse.data);
      res.json(data);
    } else {
      res.status(pythonResponse.status).json({ analyses: [] });
    }
  } catch (error) {
    console.error('Latest analysis proxy error:', error.message);
    res.status(500).json({ analyses: [], error: error.message });
  }
});

// Start server
console.log('\n' + '='.repeat(80));
console.log('✨ ORACLEX RELAY V2.5 - PUBLIC PYTHON BACKEND');
console.log('='.repeat(80));
console.log(`🚀 Listening on port ${PORT}`);
console.log(`📡 Python Backend: ${PYTHON_URL}`);
console.log(`🔗 Connection Method: HTTPS fetch (public)`);
console.log('='.repeat(80));
console.log('\nFeatures:');
console.log('  ✓ Receives market data from EA');
console.log('  ✓ Stores market state');
console.log('  ✓ Forwards to Python (public HTTPS)');
console.log('  ✓ Proxies analysis endpoints');
console.log('  ✓ Returns combined data to Dashboard');
console.log('='.repeat(80) + '\n');

app.listen(PORT, '0.0.0.0');
