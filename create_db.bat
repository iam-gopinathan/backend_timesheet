@echo off
set PGPASSWORD=iamgopi@1
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE timesheet_db;"
echo Database created!
pause
