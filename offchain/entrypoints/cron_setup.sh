#!/bin/bash
# Cron job setup script for Halom Oracle Updater

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Halom Oracle Updater cron job...${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/package.json" ]; then
    echo -e "${RED}Error: This script must be run from the Halom project root directory${NC}"
    exit 1
fi

# Check if Python environment is set up
if [ ! -f "$PROJECT_ROOT/requirements.txt" ]; then
    echo -e "${RED}Error: requirements.txt not found. Please set up the Python environment first.${NC}"
    exit 1
fi

# Create log directory
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

# Create the cron job entry
CRON_JOB="0 * * * * cd $PROJECT_ROOT && python3 offchain/enhanced_updater.py >> $LOG_DIR/cron.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "enhanced_updater.py"; then
    echo -e "${YELLOW}Warning: Cron job already exists. Removing old entry...${NC}"
    crontab -l 2>/dev/null | grep -v "enhanced_updater.py" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo -e "${GREEN}Cron job added successfully!${NC}"
echo -e "${YELLOW}Cron job details:${NC}"
echo "Schedule: Every hour at minute 0"
echo "Command: cd $PROJECT_ROOT && python3 offchain/enhanced_updater.py"
echo "Log file: $LOG_DIR/cron.log"

# Show current cron jobs
echo -e "${YELLOW}Current cron jobs:${NC}"
crontab -l

# Create a systemd service file for better process management
echo -e "${GREEN}Creating systemd service file...${NC}"

SERVICE_FILE="/etc/systemd/system/halom-oracle.service"
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Halom Oracle Updater
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_ROOT
Environment=PATH=$PROJECT_ROOT/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$PROJECT_ROOT/venv/bin/python3 offchain/enhanced_updater.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}Systemd service file created at $SERVICE_FILE${NC}"
echo -e "${YELLOW}To enable and start the service:${NC}"
echo "sudo systemctl daemon-reload"
echo "sudo systemctl enable halom-oracle"
echo "sudo systemctl start halom-oracle"
echo "sudo systemctl status halom-oracle"

# Create monitoring script
MONITOR_SCRIPT="$PROJECT_ROOT/scripts/monitor_oracle.sh"
mkdir -p "$(dirname "$MONITOR_SCRIPT")"

tee "$MONITOR_SCRIPT" > /dev/null << 'EOF'
#!/bin/bash
# Oracle monitoring script

LOG_FILE="logs/oracle_updater.log"
ALERT_EMAIL="admin@example.com"

# Check if log file exists and is recent
if [ ! -f "$LOG_FILE" ]; then
    echo "ERROR: Log file not found"
    exit 1
fi

# Check last update time (should be within last 2 hours)
LAST_UPDATE=$(tail -n 50 "$LOG_FILE" | grep "Transaction confirmed" | tail -n 1 | awk '{print $1, $2}')
if [ -z "$LAST_UPDATE" ]; then
    echo "ERROR: No recent updates found in log"
    exit 1
fi

# Convert to timestamp and check if recent
LAST_UPDATE_TS=$(date -d "$LAST_UPDATE" +%s)
CURRENT_TS=$(date +%s)
DIFF_HOURS=$(( (CURRENT_TS - LAST_UPDATE_TS) / 3600 ))

if [ $DIFF_HOURS -gt 2 ]; then
    echo "WARNING: Last update was $DIFF_HOURS hours ago"
    # Send alert email
    echo "Oracle updater may be down. Last update: $LAST_UPDATE" | mail -s "Halom Oracle Alert" "$ALERT_EMAIL"
fi

echo "Oracle status: OK (last update: $LAST_UPDATE)"
EOF

chmod +x "$MONITOR_SCRIPT"

echo -e "${GREEN}Monitoring script created at $MONITOR_SCRIPT${NC}"

# Create log rotation configuration
ROTATE_FILE="/etc/logrotate.d/halom-oracle"
sudo tee "$ROTATE_FILE" > /dev/null << EOF
$LOG_DIR/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        systemctl reload halom-oracle > /dev/null 2>&1 || true
    endscript
}
EOF

echo -e "${GREEN}Log rotation configured at $ROTATE_FILE${NC}"

echo -e "${GREEN}Setup complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Configure your .env file with proper credentials"
echo "2. Test the updater manually: python3 offchain/enhanced_updater.py"
echo "3. Enable systemd service: sudo systemctl enable halom-oracle"
echo "4. Start the service: sudo systemctl start halom-oracle"
echo "5. Monitor logs: tail -f logs/oracle_updater.log" 