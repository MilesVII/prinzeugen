
API_URL=""
TG_ME=""
TOT_BOKEN=""

sendMessage() {
  local MESSAGE=$1

  local API_URL="https://api.telegram.org/bot$TOT_BOKEN/sendMessage"

  curl -s -X POST $API_URL -d chat_id="$TG_ME" -d text="$MESSAGE"
}

sendFile() {
  local FILENAME=$1

  local API_URL="https://api.telegram.org/bot$TOT_BOKEN/sendDocument"

  curl -F chat_id="$TG_ME" -F document=@"$FILENAME" $API_URL
}

export PGPASSWORD=""

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUPNAME="./prinzeugen-whole-$TIMESTAMP.sql"

pg_dump -U kriegsspiel -d prinzeugen -F plain -f "$BACKUPNAME"

if [ $? -eq 0 ]; then
  sendMessage "Here is your weekly backup"
  sendFile "$BACKUPNAME"
  rm "./$BACKUPNAME"
else
  sendMessage "Achtung! Weekly backup failed!"
fi
