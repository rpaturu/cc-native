/**
 * Graph Service Implementation - Phase 2
 * 
 * Implements graph operations using Gremlin on Neptune.
 * All operations are idempotent and bounded.
 */

import * as gremlin from 'gremlin';
import { NeptuneConnection } from './NeptuneConnection';
import { IGraphService, Vertex, Edge, QueryOptions } from './IGraphService';
import { Logger } from '../core/Logger';

// Gremlin types from package structure
type GraphTraversalSource = gremlin.process.GraphTraversalSource;
const __ = gremlin.process.statics;
const T = gremlin.process.t;

const logger = new Logger('GraphService');

/**
 * Default query limits (bounded query contract)
 */
const DEFAULT_LIMIT = 100;
const DEFAULT_DEPTH = 3;

/**
 * Graph Service Implementation
 */
export class GraphService implements IGraphService {
  private connection: NeptuneConnection;

  constructor(connection: NeptuneConnection) {
    this.connection = connection;
  }

  /**
   * Get Gremlin traversal source
   */
  private async getG(): Promise<GraphTraversalSource> {
    return await this.connection.getTraversal();
  }

  /**
   * Get current timestamp (ISO format)
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Upsert vertex (idempotent)
   * 
   * Gremlin pattern:
   * g.V(vertexId).fold().coalesce(
   *   unfold(),
   *   addV(label).property(id, vertexId).property(...properties)
   * ).property('updated_at', now).next()
   */
  async upsertVertex(
    vertexId: string,
    label: string,
    properties: Record<string, any>
  ): Promise<void> {
    try {
      const g = await this.getG();
      const now = this.getCurrentTimestamp();

      // Ensure required properties
      const finalProperties: Record<string, any> = {
        ...properties,
        updated_at: now,
      };

      // If vertex doesn't exist, set created_at
      if (!properties.created_at) {
        finalProperties.created_at = now;
      }

      // Idempotent upsert pattern for Neptune (string IDs)
      // Check if vertex exists
      const existingVertex = await g.V(vertexId).next();
      
      if (!existingVertex.value) {
        // Vertex doesn't exist - create it with ID and all properties
        const addVTraversal = g.addV(label).property(T.id, vertexId);
        
        // Set all properties during creation
        for (const [key, value] of Object.entries(finalProperties)) {
          if (key !== 'id') {
            addVTraversal.property(key, value);
          }
        }
        
        await addVTraversal.next();
        logger.debug('Vertex created', { vertexId, label });
      } else {
        // Vertex exists - update properties
        const updateTraversal = g.V(vertexId);
        for (const [key, value] of Object.entries(finalProperties)) {
          if (key !== 'id' && key !== 'created_at') {
            // Don't overwrite created_at, only update updated_at and other properties
            updateTraversal.property(key, value);
          }
        }
        await updateTraversal.next();
        logger.debug('Vertex updated', { vertexId, label });
      }

      logger.debug('Vertex upserted', { vertexId, label });
    } catch (error) {
      logger.error('Failed to upsert vertex', { vertexId, label, error });
      throw error;
    }
  }

  /**
   * Upsert edge (idempotent)
   * 
   * Gremlin pattern (prevents duplicates):
   * g.V(fromVertexId).as('from')
   *  .coalesce(
   *    __.outE(edgeLabel).where(__.inV().hasId(toVertexId)),
   *    __.V(toVertexId).addE(edgeLabel).from('from').property(...properties)
   *  ).next()
   */
  async upsertEdge(
    fromVertexId: string,
    toVertexId: string,
    edgeLabel: string,
    properties?: Record<string, any>
  ): Promise<void> {
    try {
      const g = await this.getG();
      const now = this.getCurrentTimestamp();

      // Ensure both vertices exist
      const fromVertex = await g.V(fromVertexId).next();
      const toVertex = await g.V(toVertexId).next();

      if (!fromVertex.value) {
        throw new Error(`From vertex not found: ${fromVertexId}`);
      }
      if (!toVertex.value) {
        throw new Error(`To vertex not found: ${toVertexId}`);
      }

      // Build final properties
      const finalProperties: Record<string, any> = {
        ...(properties || {}),
        updated_at: now,
      };

      // If edge doesn't exist, set created_at
      if (!properties?.created_at) {
        finalProperties.created_at = now;
      }

      // Idempotent edge upsert pattern
      // Check if edge already exists, if not create it
      const existingEdge = await g
        .V(fromVertexId)
        .outE(edgeLabel)
        .where(__.inV().hasId(toVertexId))
        .next();

      if (!existingEdge.value) {
        // Edge doesn't exist, create it
        let traversal = g
          .V(fromVertexId)
          .as('from')
          .V(toVertexId)
          .addE(edgeLabel)
          .from_('from');

        // Add properties
        for (const [key, value] of Object.entries(finalProperties)) {
          traversal = traversal.property(key, value);
        }

        await traversal.next();
        logger.debug('Edge created', { fromVertexId, toVertexId, edgeLabel });
      } else {
        // Edge exists, update properties
        const edgeId = existingEdge.value.id;
        for (const [key, value] of Object.entries(finalProperties)) {
          await g.E(edgeId).property(key, value).next();
        }
        logger.debug('Edge updated', { fromVertexId, toVertexId, edgeLabel });
      }
    } catch (error) {
      logger.error('Failed to upsert edge', {
        fromVertexId,
        toVertexId,
        edgeLabel,
        error,
      });
      throw error;
    }
  }

  /**
   * Get vertex by ID
   */
  async getVertex(vertexId: string): Promise<Vertex | null> {
    try {
      const g = await this.getG();
      const result = await g.V(vertexId).next();

      if (!result.value) {
        return null;
      }

      const vertex = result.value;
      const properties: Record<string, any> = {};

      // Extract properties from vertex
      if (vertex.properties) {
        for (const [key, value] of Object.entries(vertex.properties)) {
          // Gremlin properties are arrays, get first value
          if (Array.isArray(value) && value.length > 0) {
            properties[key] = value[0].value;
          } else {
            properties[key] = value;
          }
        }
      }

      return {
        id: vertex.id,
        label: vertex.label,
        properties,
      };
    } catch (error) {
      logger.error('Failed to get vertex', { vertexId, error });
      throw error;
    }
  }

  /**
   * Get edges from vertex (bounded)
   * 
   * Maximum 100 results by default.
   */
  async getEdges(
    vertexId: string,
    edgeLabel?: string,
    options?: QueryOptions
  ): Promise<Edge[]> {
    try {
      const g = await this.getG();
      const limit = options?.limit || DEFAULT_LIMIT;

      let traversal = g.V(vertexId).outE();

      if (edgeLabel) {
        traversal = traversal.hasLabel(edgeLabel);
      }

      const results = await traversal.limit(limit).toList();

      return results.map((edge: any) => {
        const properties: Record<string, any> = {};

        // Extract properties
        if (edge.properties) {
          for (const [key, value] of Object.entries(edge.properties)) {
            if (Array.isArray(value) && value.length > 0) {
              properties[key] = value[0].value;
            } else {
              properties[key] = value;
            }
          }
        }

        return {
          id: edge.id,
          label: edge.label,
          from: edge.outV.id,
          to: edge.inV.id,
          properties,
        };
      });
    } catch (error) {
      logger.error('Failed to get edges', { vertexId, edgeLabel, error });
      throw error;
    }
  }

  /**
   * Delete vertex (soft delete via tombstone)
   * 
   * Marks vertex as deleted rather than removing it.
   */
  async deleteVertex(vertexId: string): Promise<void> {
    try {
      const g = await this.getG();
      const now = this.getCurrentTimestamp();

      // Soft delete: mark as deleted
      await g
        .V(vertexId)
        .property('deleted', true)
        .property('deleted_at', now)
        .property('updated_at', now)
        .next();

      logger.debug('Vertex soft deleted', { vertexId });
    } catch (error) {
      logger.error('Failed to delete vertex', { vertexId, error });
      throw error;
    }
  }

  /**
   * Query vertices (bounded)
   * 
   * Executes a bounded query with explicit limits.
   * No unbounded traversals allowed.
   */
  async queryVertices(
    query: (g: GraphTraversalSource) => any,
    options?: QueryOptions
  ): Promise<Vertex[]> {
    try {
      const g = await this.getG();
      const limit = options?.limit || DEFAULT_LIMIT;
      const depth = options?.depth || DEFAULT_DEPTH;

      // Execute query with bounds
      let traversal = query(g);
      
      // Ensure limit is applied
      if (typeof traversal.limit === 'function') {
        traversal = traversal.limit(limit);
      }

      const results = await traversal.toList();

      return results.map((vertex: any) => {
        const properties: Record<string, any> = {};

        // Extract properties
        if (vertex.properties) {
          for (const [key, value] of Object.entries(vertex.properties)) {
            if (Array.isArray(value) && value.length > 0) {
              properties[key] = value[0].value;
            } else {
              properties[key] = value;
            }
          }
        }

        return {
          id: vertex.id,
          label: vertex.label,
          properties,
        };
      });
    } catch (error) {
      logger.error('Failed to query vertices', { error });
      throw error;
    }
  }

  /**
   * Get neighbors of a vertex (bounded, with depth tracking)
   * 
   * Returns vertices reachable from the source vertex up to maxDepth.
   * Each vertex includes depth information (1 = immediate neighbors, 2 = neighbors of neighbors, etc.)
   * Bounded: maximum limit results total.
   */
  async getNeighbors(
    vertexId: string,
    options?: { maxDepth?: number; limit?: number }
  ): Promise<Vertex[]> {
    try {
      const g = await this.getG();
      const maxDepth = options?.maxDepth || 2;
      const limit = options?.limit || 100;

      // Use repeat() to traverse up to maxDepth, then collect all vertices with their depth
      // Pattern: g.V(vertexId).repeat(__.out()).times(maxDepth).emit().dedup().limit(limit)
      const results: Array<{ vertex: any; depth: number }> = [];
      const visited = new Set<string>();
      
      // Start from source vertex
      const sourceVertex = await g.V(vertexId).next();
      if (!sourceVertex.value) {
        return [];
      }

      // Traverse neighbors at each depth level
      for (let depth = 1; depth <= maxDepth && results.length < limit; depth++) {
        let traversal;
        if (depth === 1) {
          // Depth 1: immediate neighbors
          traversal = g.V(vertexId).out();
        } else {
          // Depth 2+: neighbors of neighbors (using repeat)
          traversal = g.V(vertexId).repeat(__.out()).times(depth).dedup();
        }

        const depthResults = await traversal.limit(limit - results.length).toList();
        
        for (const vertexResult of depthResults) {
          // Gremlin toList() returns vertices directly (not wrapped in .value)
          const vertex: any = vertexResult;
          const vertexIdStr = String(vertex.id);
          if (!visited.has(vertexIdStr)) {
            visited.add(vertexIdStr);
            
            const properties: Record<string, any> = {};
            if (vertex.properties) {
              for (const [key, value] of Object.entries(vertex.properties)) {
                if (Array.isArray(value) && value.length > 0) {
                  properties[key] = value[0].value;
                } else {
                  properties[key] = value;
                }
              }
            }

            results.push({
              vertex: {
                id: vertexIdStr,
                label: vertex.label,
                properties,
                depth,
              },
              depth,
            });

            if (results.length >= limit) {
              break;
            }
          }
        }
      }

      return results.map(r => r.vertex);
    } catch (error) {
      logger.error('Failed to get neighbors', { vertexId, error });
      throw error;
    }
  }
}
