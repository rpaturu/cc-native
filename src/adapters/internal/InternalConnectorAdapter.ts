/**
 * Internal Connector Adapter
 * 
 * Handles internal system operations (notes, tasks) with DynamoDB persistence.
 * This is the safest adapter as it has no external dependencies.
 */

import { IConnectorAdapter } from '../IConnectorAdapter';
import { MCPToolInvocation, MCPResponse } from '../../types/MCPTypes';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../services/core/Logger';
import { ValidationError } from '../../types/ExecutionErrors';
import { ExternalObjectRef } from '../../types/ExecutionTypes';

export class InternalConnectorAdapter implements IConnectorAdapter {
  constructor(
    private dynamoClient: DynamoDBDocumentClient,
    private notesTableName: string,
    private tasksTableName: string,
    private logger: Logger
  ) {}

  async execute(invocation: MCPToolInvocation): Promise<MCPResponse> {
    const { name, arguments: args } = invocation.params;
    const invocationId = invocation.id; // ✅ id is at top level, not in params

    // ✅ MUST-FIX: Validate tenant_id and account_id presence (security: tenant binding)
    if (!args.tenant_id || !args.account_id) {
      throw new ValidationError(
        'Missing required fields: tenant_id and account_id must be present in tool arguments. ' +
        'This is required for tenant binding validation and data isolation.',
        'TENANT_BINDING_MISSING'
      );
    }

    // ✅ Validate tenant binding (identity.tenantId matches args.tenant_id)
    if (invocation.identity?.tenantId && invocation.identity.tenantId !== args.tenant_id) {
      throw new ValidationError(
        `Tenant mismatch: identity tenant_id (${invocation.identity.tenantId}) does not match tool argument tenant_id (${args.tenant_id})`
      );
    }

    if (name === 'internal.create_note') {
      return await this.createNote(args, invocationId);
    }

    if (name === 'internal.create_task') {
      return await this.createTask(args, invocationId);
    }

    throw new ValidationError(`Unknown tool: ${name}`);
  }

  async validate(parameters: Record<string, any>): Promise<{ valid: boolean; error?: string }> {
    // Basic validation - required fields checked in execute()
    if (!parameters.tenant_id || !parameters.account_id) {
      return { valid: false, error: 'tenant_id and account_id are required' };
    }
    return { valid: true };
  }

  private async createNote(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
    const { content, tenant_id, account_id } = args;

    if (!content) {
      throw new ValidationError('Missing required field: content');
    }

    // ✅ MUST-FIX: Implement internal adapter persistence before returning success
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    // Persist to DynamoDB
    await this.dynamoClient.send(new PutCommand({
      TableName: this.notesTableName,
      Item: {
        pk: `TENANT#${tenant_id}#ACCOUNT#${account_id}`,
        sk: `NOTE#${noteId}`,
        note_id: noteId,
        content,
        tenant_id,
        account_id,
        created_at: now,
        created_by: invocationId, // Track which invocation created this
      },
    }));

    this.logger.info('Internal note created', { noteId, tenant_id, account_id });

    const externalObjectRef: ExternalObjectRef = {
      system: 'INTERNAL',
      object_type: 'Note',
      object_id: noteId,
    };

    return {
      jsonrpc: '2.0',
      id: invocationId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_refs: [externalObjectRef],
          }),
        }],
      },
    };
  }

  private async createTask(args: Record<string, any>, invocationId: string): Promise<MCPResponse> {
    const { title, description, tenant_id, account_id } = args;

    if (!title) {
      throw new ValidationError('Missing required field: title');
    }

    // ✅ MUST-FIX: Implement internal adapter persistence before returning success
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    // Persist to DynamoDB
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tasksTableName,
      Item: {
        pk: `TENANT#${tenant_id}#ACCOUNT#${account_id}`,
        sk: `TASK#${taskId}`,
        task_id: taskId,
        title,
        description,
        tenant_id,
        account_id,
        created_at: now,
        created_by: invocationId, // Track which invocation created this
      },
    }));

    this.logger.info('Internal task created', { taskId, tenant_id, account_id });

    const externalObjectRef: ExternalObjectRef = {
      system: 'INTERNAL',
      object_type: 'Task',
      object_id: taskId,
    };

    return {
      jsonrpc: '2.0',
      id: invocationId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            external_object_refs: [externalObjectRef],
          }),
        }],
      },
    };
  }
}
