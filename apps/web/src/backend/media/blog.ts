// src/backend/blog.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- stubs (adjust paths if needed) ----
import { BlogServiceClient } from "globular-web-client/blog/blog_grpc_web_pb";
import * as blogpb from "globular-web-client/blog/blog_pb";

/* =====================================================================================
 * Client + metadata (same as your other controllers)
 * ===================================================================================== */

function clientFactory(): BlogServiceClient {
  const base = getBaseUrl() ?? "";
  return new BlogServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/* =====================================================================================
 * Defaults + caches
 * ===================================================================================== */

const DEFAULT_INDEX = "/search/blogposts";

const postsCache = new Map<string, blogpb.BlogPost>();

/* =====================================================================================
 * VM (View-Model) helpers — match proto exactly, be defensive on getters/setters casing
 * ===================================================================================== */

export type BlogPostVM = {
  uuid: string;
  author?: string;
  text?: string;       // JSON string
  title?: string;
  subtitle?: string;
  language?: string;
  keywords?: string[];
  creationTime?: number;  // epoch seconds (proto int64)
  thumbnail?: string;
  status?: blogpb.BogPostStatus; // DRAFT|PUBLISHED|ARCHIVED
  mac?: string;
  domain?: string;
  // counts (derived)
  commentsCount?: number;
  emojisCount?: number;
};

function g<T>(obj: any, nameVariants: string[], fallback?: T): T | undefined {
  for (const n of nameVariants) {
    const fn = obj?.[n];
    if (typeof fn === "function") {
      try { return fn.call(obj) as T; } catch {}
    }
  }
  return fallback;
}
function s(obj: any, nameVariants: string[], v: any) {
  for (const n of nameVariants) {
    const fn = obj?.[n];
    if (typeof fn === "function") { try { fn.call(obj, v); return; } catch {} }
  }
}

export function toVM(p: blogpb.BlogPost): BlogPostVM {
  const emotions: blogpb.Emoji[] = g(p, ["getEmotionsList", "getEmotionslist", "getEmotions"]) ?? [];
  const comments: blogpb.Comment[] = g(p, ["getCommentsList", "getCommentslist", "getComments"]) ?? [];

  return {
    uuid:        g(p, ["getUuid"]) ?? "",
    author:      g(p, ["getAuthor"]),
    text:        g(p, ["getText"]),
    title:       g(p, ["getTitle"]),
    subtitle:    g(p, ["getSubtitle"]),
    language:    g(p, ["getLanguage"]),
    keywords:    g(p, ["getKeywordsList", "getKeywordslist"]) ?? [],
    creationTime:g(p, ["getCreationtime", "getCreationTime"]) ?? 0,
    thumbnail:   g(p, ["getThumbnail"]),
    status:      g(p, ["getStatus"]),
    mac:         g(p, ["getMac"]),
    domain:      g(p, ["getDomain"]),
    commentsCount: (comments?.length) || 0,
    emojisCount:   (emotions?.length) || 0,
  };
}

export function fromVM(vm: BlogPostVM): blogpb.BlogPost {
  const post = new blogpb.BlogPost();

  s(post, ["setUuid"], vm.uuid ?? "");
  if (vm.author      != null) s(post, ["setAuthor"], vm.author);
  if (vm.text        != null) s(post, ["setText"], vm.text);
  if (vm.title       != null) s(post, ["setTitle"], vm.title);
  if (vm.subtitle    != null) s(post, ["setSubtitle"], vm.subtitle);
  if (vm.language    != null) s(post, ["setLanguage"], vm.language);
  if (vm.keywords    != null) s(post, ["setKeywordsList"], vm.keywords);
  if (vm.creationTime!= null) s(post, ["setCreationtime", "setCreationTime"], vm.creationTime);
  if (vm.thumbnail   != null) s(post, ["setThumbnail"], vm.thumbnail);
  if (vm.status      != null) s(post, ["setStatus"], vm.status);
  if (vm.mac         != null) s(post, ["setMac"], vm.mac);
  if (vm.domain      != null) s(post, ["setDomain"], vm.domain);

  return post;
}

/* =====================================================================================
 * Create / Save / Delete
 * ===================================================================================== */

/** Create a new blog post. Returns the created BlogPost. */
export async function createBlogPost(params: {
  indexPath?: string;
  account_id: string;
  language: string;
  keywords?: string[];
  title: string;
  subtitle?: string;
  thumbnail?: string;
  text: string;
}): Promise<blogpb.BlogPost> {
  const md = await meta();
  const rq = new blogpb.CreateBlogPostRequest();
  rq.setIndexpath(params.indexPath ?? DEFAULT_INDEX);
  rq.setAccountId(params.account_id);   // field: account_id
  rq.setLanguage(params.language);
  rq.setTitle(params.title);
  if (params.keywords?.length) rq.setKeywordsList(params.keywords);
  if (params.subtitle) rq.setSubtitle(params.subtitle);
  if (params.thumbnail) rq.setThumbnail(params.thumbnail);
  rq.setText(params.text);

  const rsp = await unary(clientFactory, "createBlogPost", rq, undefined, md) as blogpb.CreateBlogPostResponse;
  const created: blogpb.BlogPost | undefined = (rsp as any)?.getBlogPost?.();
  if (!created) throw new Error("CreateBlogPost returned no blog_post");
  const uuid = g(created, ["getUuid"], "");
  if (uuid) postsCache.set(uuid, created);
  return created;
}

/** Save (update) an existing blog post. */
export async function saveBlogPost(params: {
  uuid: string;
  blog_post: blogpb.BlogPost;
  indexPath?: string;
}): Promise<void> {
  const md = await meta();
  const rq = new blogpb.SaveBlogPostRequest();
  rq.setUuid(params.uuid);
  rq.setBlogPost(params.blog_post);
  rq.setIndexpath(params.indexPath ?? DEFAULT_INDEX);

  await unary(clientFactory, "saveBlogPost", rq, undefined, md);

  postsCache.set(params.uuid, params.blog_post);
}

/** Delete a blog post by uuid. */
export async function deleteBlogPost(uuid: string, indexPath = DEFAULT_INDEX): Promise<void> {
  const md = await meta();
  const rq = new blogpb.DeleteBlogPostRequest();
  rq.setUuid(uuid);
  rq.setIndexpath(indexPath);
  await unary(clientFactory, "deleteBlogPost", rq, undefined, md);

  postsCache.delete(uuid);
}

/* =====================================================================================
 * Lookups / Lists / Streams
 * ===================================================================================== */

/** Get posts by exact UUIDs (streaming from service). */
export async function getBlogPostsByUUIDs(
  uuids: string[],
  onPost: (p: blogpb.BlogPost) => void
): Promise<void> {
  if (!uuids?.length) return;

  const md = await meta();
  const rq = new blogpb.GetBlogPostsRequest();
  rq.setUuidsList(uuids);

  await stream(
    clientFactory,
    "getBlogPosts",
    rq,
    (m: any) => {
      const p: blogpb.BlogPost | undefined = (m as blogpb.GetBlogPostsResponse)?.getBlogPost?.();
      if (p) {
        const id = g(p, ["getUuid"], "");
        if (id) postsCache.set(id, p);
        onPost(p);
      }
    },
    "blog.BlogService",
    md
  );
}

/** Get posts by authors (streaming). */
export async function getBlogPostsByAuthors(
  authors: string[],
  max = 50,
  onPost?: (p: blogpb.BlogPost) => void
): Promise<void> {
  if (!authors?.length) return;

  const md = await meta();
  const rq = new blogpb.GetBlogPostsByAuthorsRequest();
  rq.setAuthorsList(authors);
  rq.setMax(max);

  await stream(
    clientFactory,
    "getBlogPostsByAuthors",
    rq,
    (m: any) => {
      const p: blogpb.BlogPost | undefined = (m as blogpb.GetBlogPostsByAuthorsResponse)?.getBlogPost?.();
      if (p) {
        const id = g(p, ["getUuid"], "");
        if (id) postsCache.set(id, p);
        onPost?.(p);
      }
    },
    "blog.BlogService",
    md
  );
}

/* =====================================================================================
 * Search (streaming)
 * ===================================================================================== */

export type BlogSearchHandlers = {
  onSummary?: (s: blogpb.SearchSummary) => void;
  onHit?: (hit: blogpb.SearchHit) => void;     // hit.getBlog()
  onFacets?: (f: blogpb.SearchFacets) => void;
  onDone?: () => void;
  onError?: (err: any) => void;
};

export async function searchBlogPosts(
  query: string,
  options?: {
    fields?: string[];
    indexPath?: string;
    size?: number;
    offset?: number;
  },
  handlers?: BlogSearchHandlers
): Promise<void> {
  const md = await meta();
  const rq = new blogpb.SearchBlogPostsRequest();
  rq.setQuery(query);
  if (options?.fields?.length) rq.setFieldsList(options.fields);
  rq.setIndexpath(options?.indexPath ?? DEFAULT_INDEX);
  rq.setSize(options?.size ?? 25);
  rq.setOffset(options?.offset ?? 0);

  await stream(
    clientFactory,
    "searchBlogPosts",
    rq,
    (m: any) => {
      // oneof: summary | hit | facets
      if (m?.getSummary?.()) {
        handlers?.onSummary?.(m.getSummary() as blogpb.SearchSummary);
        return;
      }
      if (m?.getFacets?.()) {
        handlers?.onFacets?.(m.getFacets() as blogpb.SearchFacets);
        return;
      }
      if (m?.getHit?.()) {
        const hit = m.getHit() as blogpb.SearchHit;
        const blog = hit?.getBlog?.();
        if (blog) {
          const id = g(blog, ["getUuid"], "");
          if (id) postsCache.set(id, blog);
        }
        handlers?.onHit?.(hit);
        return;
      }
    },
    "blog.BlogService",
    md
  ).catch((err) => handlers?.onError?.(err))
   .finally(() => handlers?.onDone?.());
}

/* =====================================================================================
 * Emojis / Comments
 * ===================================================================================== */

export async function addEmoji(targetUuid: string, emoji: blogpb.Emoji): Promise<blogpb.Emoji | undefined> {
  const md = await meta();
  const rq = new blogpb.AddEmojiRequest();
  rq.setUuid(targetUuid);
  rq.setEmoji(emoji);
  const rsp = await unary(clientFactory, "addEmoji", rq, undefined, md) as blogpb.AddEmojiResponse;
  return (rsp as any)?.getEmoji?.();
}

export async function removeEmoji(targetUuid: string, emoji: blogpb.Emoji): Promise<blogpb.Emoji | undefined> {
  const md = await meta();
  const rq = new blogpb.RemoveEmojiRequest();
  rq.setUuid(targetUuid);
  rq.setEmoji(emoji);
  const rsp = await unary(clientFactory, "removeEmoji", rq, undefined, md) as blogpb.RemoveEmojiResponse;
  return (rsp as any)?.getEmoji?.();
}

export async function addComment(targetUuid: string, comment: blogpb.Comment): Promise<blogpb.Comment | undefined> {
  const md = await meta();
  const rq = new blogpb.AddCommentRequest();
  rq.setUuid(targetUuid);
  rq.setComment(comment);
  const rsp = await unary(clientFactory, "addComment", rq, undefined, md) as blogpb.AddCommentResponse;
  return (rsp as any)?.getComment?.();
}

export async function removeComment(targetUuid: string, comment: blogpb.Comment): Promise<void> {
  const md = await meta();
  const rq = new blogpb.RemoveCommentRequest();
  rq.setUuid(targetUuid);
  rq.setComment(comment);
  await unary(clientFactory, "removeComment", rq, undefined, md);
}

/* =====================================================================================
 * Cache utilities
 * ===================================================================================== */

export function cacheSetPost(p: blogpb.BlogPost) {
  const id = g(p, ["getUuid"], "");
  if (id) postsCache.set(id, p);
}
export function cacheGetPost(uuid: string): blogpb.BlogPost | undefined {
  return postsCache.get(uuid);
}
export function clearAllBlogCaches() {
  postsCache.clear();
}
