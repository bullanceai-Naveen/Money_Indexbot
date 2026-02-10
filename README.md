# Index OI Scanner 📊

Real-time Options Open Interest (OI) monitoring system for Indian market indices.

## Features

- **Multi-Index Support**: NIFTY 50, BANK NIFTY, FIN NIFTY, SENSEX, CRUDE OIL, NATURAL GAS
- **Real-time OI Analysis**: Strike-level OI tracking with bullish/bearish signals
- **IV Tracking**: Implied Volatility monitoring and pattern detection
- **Candlestick Charts**: Price action with integrated OI sentiment
- **Support/Resistance**: Automatic S/R level detection from OI data
- **Max Pain**: Real-time max pain calculation
- **WebSocket Updates**: Live data streaming to frontend

## Tech Stack

- **Backend**: FastAPI (Python)
- **Database**: SQLite
- **Frontend**: Vanilla JS + D3.js
- **Data Source**: Upstox API

---

## 🚀 Deployment on Render.com (Free)

### Step 1: Push to GitHub

1. Create a new **private** repository on GitHub
2. Push this code:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/index-oi-scanner.git
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign up with GitHub
2. Click **"New +"** → **"Web Service"**
3. Connect your `index-oi-scanner` repository
4. Configure:
   - **Name**: `index-oi-scanner`
   - **Region**: `Singapore` (closest to India)
   - **Branch**: `main`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt && python init_db.py`
   - **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: `Free`

5. **Add Environment Variable**:
   - Key: `UPSTOX_ACCESS_TOKENS`
   - Value: `your_upstox_access_token_here`

6. Click **"Create Web Service"**

### Step 3: Access Your App

After deployment (3-5 minutes), you'll get a URL like:
```
https://index-oi-scanner.onrender.com
```

---

## 🔄 Daily Token Update

Upstox access tokens expire daily. To update:

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on your `index-oi-scanner` service
3. Go to **"Environment"** tab
4. Edit `UPSTOX_ACCESS_TOKENS` with your new token
5. Click **"Save Changes"**

The service will automatically restart with the new token.

---

## 📁 Project Structure

```
index-oi-scanner/
├── server.py           # FastAPI backend
├── config.py           # Configuration (indices, settings)
├── init_db.py          # Database initialization
├── requirements.txt    # Python dependencies
├── Procfile            # Render process file
├── render.yaml         # Render configuration
├── .gitignore          # Git ignore rules
└── static/
    ├── index.html      # Main HTML page
    ├── app.js          # Frontend application
    ├── charts.js       # D3.js chart manager
    └── styles.css      # Styling
```

---

## ⚙️ Configuration

Edit `config.py` to modify:

- **Active Indices**: `ACTIVE_INDICES` list
- **Strike Range**: `strikes_range` per index
- **Polling Interval**: `POLLING_INTERVAL` (default: 20 seconds)
- **Signal Thresholds**: `BULLISH_NET_THRESHOLD`, `BEARISH_NET_THRESHOLD`

---

## 🔧 Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Initialize database
python init_db.py

# Set token
export UPSTOX_ACCESS_TOKENS='your_token_here'

# Run server
python run.py
# Or
uvicorn server:app --reload --port 8001

# Open browser
# http://localhost:8001
```

---

## 📊 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Main dashboard |
| `GET /api/dashboard` | All indices summary |
| `GET /api/{index}/strikes/live` | Strike-level OI data |
| `GET /api/{index}/candles` | Candlestick + OI data |
| `GET /api/{index}/timeseries` | Historical timeseries |
| `GET /api/{index}/iv` | IV analysis data |
| `WS /ws` | WebSocket for real-time updates |

---

## ⚠️ Important Notes

1. **Free Tier Limitations**:
   - Service sleeps after 15 mins of inactivity
   - First request after sleep takes 30-60 seconds
   - 750 free hours/month

2. **Database**:
   - SQLite data resets on each deploy
   - Daily data is tracked within session

3. **Token Security**:
   - Never commit your token to Git
   - Always use environment variables

---

## 📝 License

Private use only. Not for distribution.

---

## 🙏 Support

For issues or questions, create an issue in the repository.