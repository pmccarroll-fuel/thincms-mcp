export interface ApiResult {
  ok: boolean;
  status: number;
  data: any;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  status: string;
  featured: boolean;
  pinnedUntil: string | null;
  series: string | null;
  seriesOrder: number | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  author: Author | null;
  categories: Category[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  content: string;
  status: string;
  renderMode: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  siteId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
}

export interface Author {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  email: string | null;
  website: string | null;
  social: Record<string, string> | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  postCount?: number;
}

export interface Media {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  path: string;
  thumbnailPath: string | null;
  visibility: string;
  createdAt: string;
}

export interface Form {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  fields: string;
  renderMode: string;
  htmlContent: string | null;
  webhookUrl: string | null;
  successMessage: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface Script {
  id: string;
  name: string;
  code: string;
  placement: string;
  enabled: boolean;
  sortOrder: number;
}

export interface Secret {
  id: string;
  key: string;
  description: string | null;
}

export interface NavItem {
  label: string;
  type: "page" | "route" | "external";
  target: string;
}
