-- Create user if not exists
CREATE USER "user" WITH PASSWORD 'password' CREATEDB;

-- Create database
CREATE DATABASE appchat OWNER "user";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE appchat TO "user";
