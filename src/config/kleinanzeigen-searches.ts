export interface SearchTarget {
  id: string;
  label: string;
  query: string;
  max_price: number;
  min_price?: number;
  page_count?: number;
  location?: string;
  radius?: number;
}

export const GPU_SEARCHES: SearchTarget[] = [
  {
    id: "rtx-3090",
    label: "RTX 3090 24 GB",
    query: '"RTX 3090" 24GB -Ti -laptop -mobile',
    max_price: 850,
    page_count: 2,
  },
  {
    id: "rtx-3090-ti",
    label: "RTX 3090 Ti 24 GB",
    query: '"RTX 3090 Ti" 24GB -laptop -mobile',
    max_price: 950,
    page_count: 2,
  },
  {
    id: "rtx-a5000",
    label: "RTX A5000 24 GB",
    query: '"RTX A5000" 24GB -laptop -mobile -A5000M',
    max_price: 1500,
    page_count: 2,
  },
  {
    id: "rtx-a5500",
    label: "RTX A5500 24 GB",
    query: '"RTX A5500" 24GB -laptop -mobile',
    max_price: 2000,
    page_count: 2,
  },
  {
    id: "rtx-a6000",
    label: "RTX A6000 48 GB",
    query: '"RTX A6000" 48GB -Ada -laptop',
    max_price: 2500,
    page_count: 2,
  },
  {
    id: "nvidia-a40",
    label: "NVIDIA A40 48 GB",
    query: '("NVIDIA A40" OR "Tesla A40") 48GB',
    max_price: 2200,
    page_count: 2,
  },
  {
    id: "rtx-4080-32gb",
    label: "RTX 4080 32 GB AI server",
    query: '"RTX 4080" 32GB AI server',
    max_price: 1400,
    page_count: 2,
  },
];
