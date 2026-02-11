/**
 * Notion API Service
 *
 * Queries Notion databases for campaign content.
 * Replaces Notion MCP with direct API calls.
 */

import { Client } from '@notionhq/client';
import { config } from '../config';

// Client is created lazily to avoid errors when token is not configured
let notion: Client | null = null;

function getNotion(): Client {
  if (!notion) {
    if (!config.notionToken) {
      throw new Error('NOTION_TOKEN is not configured');
    }
    notion = new Client({
      auth: config.notionToken,
    });
  }
  return notion;
}

export interface CampaignResult {
  id: string;
  title: string;
  status: string;
  content: string;
  url: string;
  importance?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Search for campaigns matching a topic
 */
export async function searchCampaigns(topic: string): Promise<CampaignResult[]> {
  try {
    // Search across all pages
    const response = await getNotion().search({
      query: topic,
      filter: {
        property: 'object',
        value: 'page',
      },
      page_size: 20,
    });

    const campaigns: CampaignResult[] = [];

    for (const page of response.results) {
      if (page.object !== 'page' || !('properties' in page)) continue;

      const props = page.properties as Record<string, any>;

      // Extract title
      let title = '';
      if (props.Name?.title?.[0]?.plain_text) {
        title = props.Name.title[0].plain_text;
      } else if (props.Title?.title?.[0]?.plain_text) {
        title = props.Title.title[0].plain_text;
      }

      // Skip if no title or doesn't match topic
      if (!title) continue;

      // Extract status
      let status = '';
      if (props.Status?.status?.name) {
        status = props.Status.status.name;
      } else if (props.Status?.select?.name) {
        status = props.Status.select.name;
      }

      // Get page content
      const content = await getPageContent(page.id);

      campaigns.push({
        id: page.id,
        title,
        status,
        content,
        url: `https://notion.so/${page.id.replace(/-/g, '')}`,
        importance: props.Importance?.select?.name,
        startDate: props['Start Date']?.date?.start,
        endDate: props['End Date']?.date?.start,
      });
    }

    return campaigns;
  } catch (error) {
    console.error('Notion search error:', error);
    throw error;
  }
}

/**
 * Get the text content of a Notion page
 */
export async function getPageContent(pageId: string): Promise<string> {
  try {
    const blocks = await getNotion().blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    const textParts: string[] = [];

    for (const block of blocks.results) {
      if (!('type' in block)) continue;

      const blockType = block.type as string;
      const blockData = (block as any)[blockType];

      if (blockData?.rich_text) {
        const text = blockData.rich_text
          .map((rt: any) => rt.plain_text)
          .join('');
        if (text) textParts.push(text);
      }

      // Handle child blocks (lists, etc.)
      if (block.has_children) {
        const childContent = await getPageContent(block.id);
        if (childContent) textParts.push(childContent);
      }
    }

    return textParts.join('\n');
  } catch (error) {
    console.error(`Error getting content for page ${pageId}:`, error);
    return '';
  }
}

/**
 * Get a specific campaign by ID
 */
export async function getCampaign(pageId: string): Promise<CampaignResult | null> {
  try {
    const page = await getNotion().pages.retrieve({ page_id: pageId });

    if (!('properties' in page)) return null;

    const props = page.properties as Record<string, any>;

    let title = '';
    if (props.Name?.title?.[0]?.plain_text) {
      title = props.Name.title[0].plain_text;
    } else if (props.Title?.title?.[0]?.plain_text) {
      title = props.Title.title[0].plain_text;
    }

    let status = '';
    if (props.Status?.status?.name) {
      status = props.Status.status.name;
    }

    const content = await getPageContent(pageId);

    return {
      id: pageId,
      title,
      status,
      content,
      url: `https://notion.so/${pageId.replace(/-/g, '')}`,
      importance: props.Importance?.select?.name,
      startDate: props['Start Date']?.date?.start,
      endDate: props['End Date']?.date?.start,
    };
  } catch (error) {
    console.error(`Error getting campaign ${pageId}:`, error);
    return null;
  }
}

/**
 * Query campaigns database with filters
 */
export async function queryCampaignsDatabase(
  statusFilter?: string[]
): Promise<CampaignResult[]> {
  try {
    const filter: any = statusFilter
      ? {
          or: statusFilter.map(status => ({
            property: 'Status',
            status: { equals: status },
          })),
        }
      : undefined;

    const response = await getNotion().databases.query({
      database_id: config.notionCampaignsDbId,
      filter,
      page_size: 50,
    });

    const campaigns: CampaignResult[] = [];

    for (const page of response.results) {
      if (!('properties' in page)) continue;

      const props = page.properties as Record<string, any>;

      let title = '';
      if (props.Name?.title?.[0]?.plain_text) {
        title = props.Name.title[0].plain_text;
      }

      let status = '';
      if (props.Status?.status?.name) {
        status = props.Status.status.name;
      }

      const content = await getPageContent(page.id);

      campaigns.push({
        id: page.id,
        title,
        status,
        content,
        url: `https://notion.so/${page.id.replace(/-/g, '')}`,
        importance: props.Importance?.select?.name,
        startDate: props['Start Date']?.date?.start,
        endDate: props['End Date']?.date?.start,
      });
    }

    return campaigns;
  } catch (error) {
    console.error('Error querying campaigns database:', error);
    throw error;
  }
}
