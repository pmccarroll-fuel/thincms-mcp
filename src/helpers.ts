import type { ApiResult } from "./types.js";

export function formatResult(result: ApiResult) {
  if (result.ok) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
    };
  }
  const message = result.data?.error || result.data?.message || JSON.stringify(result.data);
  return {
    content: [{ type: "text" as const, text: `API Error (${result.status}): ${message}` }],
    isError: true,
  };
}

export function stripContentFromList(posts: any[]): any[] {
  return posts.map(({ content, ...rest }) => rest);
}
