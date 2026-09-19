-- A product's identity is its name, colour, and size. Location, price,
-- packaging, stock, and status can change without making it a new product.
CREATE UNIQUE INDEX idx_products_identity ON products (
  lower(trim(name)),
  lower(trim(coalesce(colour, ''))),
  lower(trim(coalesce(size, '')))
);
