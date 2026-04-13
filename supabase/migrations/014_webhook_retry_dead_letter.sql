ALTER TABLE webhook_retry_queue
ADD COLUMN IF NOT EXISTS dead_letter boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_webhook_retry_dead_letter
  ON webhook_retry_queue(dead_letter) WHERE dead_letter = true;
