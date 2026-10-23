SELECT 'CREATE DATABASE pickup_counter_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pickup_counter_test')\gexec
GRANT ALL PRIVILEGES ON DATABASE pickup_counter_test TO pickup;
