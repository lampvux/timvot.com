export const navigationGroups = [
  {
    label: "Catalogue",
    items: [
      { key: "brands", label: "Brands" },
      { key: "rackets", label: "Rackets" },
      { key: "racket-variants", label: "Racket variants" },
      { key: "racket-images", label: "Racket images" },
      { key: "strings", label: "Strings" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { key: "seller-applications", label: "Seller applications" },
      { key: "sellers", label: "Sellers" },
      { key: "offers", label: "Racket deals" },
      { key: "price-points", label: "Racket price history" },
      { key: "string-offers", label: "String deals" },
      { key: "string-price-points", label: "String price history" },
    ],
  },
  {
    label: "Editorial",
    items: [
      { key: "guides", label: "Guides" },
      { key: "reviews", label: "Reviews" },
    ],
  },
] as const;
