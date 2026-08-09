ALTER TABLE sales ADD COLUMN customer_name TEXT;
ALTER TABLE sales ADD COLUMN sale_date TEXT;

UPDATE sales
SET sale_date = substr(sold_at, 1, 10)
WHERE sale_date IS NULL;

CREATE INDEX idx_sales_sale_date ON sales(sale_date);
