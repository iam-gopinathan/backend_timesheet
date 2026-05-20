@echo off
set PGPASSWORD=iamgopi@1
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "\l"
