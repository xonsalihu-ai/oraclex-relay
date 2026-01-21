const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Simple in-memory storage
let marketState = { symbols: {}, analysis: {}, timestamp: null };

// Helper: Make HTTP request to Python backend
function forwardToPython(path, method, data) {
  return new Promise((resolve, reject) => {
    const pythonHost = 'oraclex-python-backend.railway.internal';
    const pythonPort = 8080;
    
    const options = {
      hostname: pythonHost,
      port: pythonPort,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: responseData
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// ENDPOINTS
app.get('/', (req, res) => {
  res.json({ status: 'OK', relay: 'V2.3', uptime: process.uptime() });
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
    console.log(`   Target: http://oraclex-python-backend.railway.internal:8080/market-data-v1.6`);
    
    try {
      const pythonResponse = await forwardToPython(
        '/market-data-v1.6',
        'POST',
        { 
          server_time: Math.floor(Date.now() / 1000), 
          market_data 
        }
      );

      console.log(`   Response status: ${pythonResponse.status}`);

      if (pythonResponse.status === 200) {
        console.log(`✅ Python accepted data - Response: ${pythonResponse.data}`);
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
    
    console.log(`📡 Proxying analysis request for ${symbol}`);
    
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
    console.log(`📡 Proxying latest-analysis request`);
    
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
console.log('✨ ORACLEX RELAY V2.3 - HTTP MODULE FIX');
console.log('='.repeat(80));
console.log(`🚀 Listening on port ${PORT}`);
console.log(`📡 Python Backend: http://oraclex-python-backend.railway.internal:8080`);
console.log(`🔗 Connection Method: Node.js http module (internal Railway network)`);
console.log('='.repeat(80));
console.log('\nFeatures:');
console.log('  ✓ Receives market data from EA');
console.log('  ✓ Stores market state');
console.log('  ✓ Forwards to Python (internal Railway network via http module)');
console.log('  ✓ Proxies analysis endpoints');
console.log('  ✓ Returns combined data to Dashboard');
console.log('='.repeat(80) + '\n');

app.listen(PORT, '0.0.0.0');
