/**
 * Graph Service Interface - Phase 2
 * 
 * Abstract interface for graph operations on Neptune.
 * All operations must be idempotent and bounded.
 */

/**
 * Vertex representation
 */
export interface Vertex {
  id: string;
  label: string;
  properties: Record<string, any>;
}

/**
 * Edge representation
 */
export interface Edge {
  id: string;
  label: string;
  from: string; // from vertex ID
  to: string; // to vertex ID
  properties: Record<string, any>;
}

/**
 * Bounded query options
 */
export interface QueryOptions {
  limit?: number; // Maximum results (default: 100)
  depth?: number; // Maximum traversal depth (default: 3)
}

/**
 * Graph Service Interface
 * 
 * All operations are idempotent and bounded to prevent unbounded traversals.
 */
export interface IGraphService {
  /**
   * Upsert vertex (idempotent)
   * 
   * Creates vertex if it doesn't exist, or updates properties if it does.
   * Uses vertex ID for idempotency.
   */
  upsertVertex(
    vertexId: string,
    label: string,
    properties: Record<string, any>
  ): Promise<void>;

  /**
   * Upsert edge (idempotent)
   * 
   * Creates edge if it doesn't exist, or updates properties if it does.
   * Prevents duplicate edges between the same vertices with the same label.
   */
  upsertEdge(
    fromVertexId: string,
    toVertexId: string,
    edgeLabel: string,
    properties?: Record<string, any>
  ): Promise<void>;

  /**
   * Get vertex by ID
   * 
   * Returns null if vertex doesn't exist.
   */
  getVertex(vertexId: string): Promise<Vertex | null>;

  /**
   * Get edges from vertex
   * 
   * Returns edges with optional label filter.
   * Bounded: maximum 100 results.
   */
  getEdges(
    vertexId: string,
    edgeLabel?: string,
    options?: QueryOptions
  ): Promise<Edge[]>;

  /**
   * Delete vertex (soft delete via tombstone)
   * 
   * Marks vertex as deleted rather than removing it.
   * Preserves graph integrity for audit trails.
   */
  deleteVertex(vertexId: string): Promise<void>;

  /**
   * Query vertices (bounded)
   * 
   * Executes a bounded query with explicit limits.
   * No unbounded traversals allowed.
   */
  queryVertices(
    query: (g: any) => any,
    options?: QueryOptions
  ): Promise<Vertex[]>;
}
