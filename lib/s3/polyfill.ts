/**
 * Polyfill DOM globals for the Cloudflare Worker runtime.
 *
 * AWS SDK v3's XML deserializer (used by ListObjectsV2, ListMultipartUploads,
 * CompleteMultipartUpload, etc.) requires `DOMParser`, `Node`, etc. which are
 * unavailable in Workers even with `nodejs_compat`.
 *
 * This module must be imported *before* any module that constructs an
 * `S3Client` (i.e. at the top of `lib/s3/client.ts`, which every S3-user
 * imports). It is a no-op in Node (scripts) where the globals already exist.
 */
import {
	DOMParser,
	Node,
	Document,
	Element,
	Attr,
	Text,
	NodeList,
	NamedNodeMap
} from '@xmldom/xmldom';

const g = globalThis as Record<string, unknown>;
if (!g.DOMParser) g.DOMParser = DOMParser;
if (!g.Node) g.Node = Node;
if (!g.Document) g.Document = Document;
if (!g.Element) g.Element = Element;
if (!g.Attr) g.Attr = Attr;
if (!g.Text) g.Text = Text;
if (!g.NodeList) g.NodeList = NodeList;
if (!g.NamedNodeMap) g.NamedNodeMap = NamedNodeMap;