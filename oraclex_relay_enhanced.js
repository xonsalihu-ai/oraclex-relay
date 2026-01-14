const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Store market data in memory
let marketState = {
  market_data: [],
  timestamp: null,
  data_age_sec: 0
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    relay_active: true,
    last_update: marketState.timestamp,
    symbols_count: marketState.market_data.length
  });
});

// Receive market data from Python
app.post('/update-market-state', (req, res) => {
  try {
    const data = req.body;
    
    if (!data || !data.market_data) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    marketState = {
      market_data: data.market_data,
      timestamp: new Date().toISOString(),
      data_age_sec: 0
    };

    console.log(`[${new Date().toLocaleTimeString()}] Received update: ${data.market_data.length} symbols`);
    
    res.json({ 
      success: true, 
      message: 'Market state updated',
      symbols_updated: data.market_data.length 
    });
  } catch (error) {
    console.error('Error updating market state:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send market data to Dashboard
app.get('/get-market-state', (req, res) => {
  try {
    // Calculate data age
    if (marketState.timestamp) {
      const age = Math.floor((new Date() - new Date(marketState.timestamp)) / 1000);
      marketState.data_age_sec = Math.max(0, age);
    }

    res.json({
      market_data: marketState.market_data,
      timestamp: marketState.timestamp,
      data_age_sec: marketState.data_age_sec,
      symbols_count: marketState.market_data.length
    });
  } catch (error) {
    console.error('Error getting market state:', error);
    res.status(500).json({ error: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OracleX Trading Relay',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      status: 'GET /status',
      update: 'POST /update-market-state',
      get_data: 'GET /get-market-state'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║     🚀 OracleX Relay Server Running 🚀       ║`);
  console.log(`╚════════════════════════════════════════════════╝`);
  console.log(`Server listening on port ${PORT}`);
  console.log(`CORS enabled`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Ready to receive data from Python!`);
});
