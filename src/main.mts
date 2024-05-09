import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Ethereum Mainnet
  "1": {
    decentralized:
      "https://gateway-arbitrum.network.thegraph.com/api/[api-key]/deployments/id/QmQBvtHaTS9MftEWYTSmbbmPqzXtMpgZRidivvEaELSKsc", // Opensea v1 Subgraph deployment for Ethereum Mainnet, by Messari team
  },
};

interface Collection {
  id: string;
  name: string;
  symbol: string;
  nftStandard: string;
}

interface GraphQLData {
  collections: Collection[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}
//defining headers for query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const GET_COLLECTIONS_QUERY = `
query GetCollections($lastId: String) {
  collections(
    first: 1000,
    orderBy: id,
    orderDirection: asc,
    where: { id_gt: $lastId }
  ) {
    id
    name
    symbol
    nftStandard
  }
}
`;

function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

function containsHtmlOrMarkdown(text: string): boolean {
  // Simple HTML tag detection
  if (/<[^>]*>/.test(text)) {
    return true;
  }
  return false;
}

async function fetchData(
  subgraphUrl: string,
  lastId: string
): Promise<Collection[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_COLLECTIONS_QUERY,
      variables: { lastId },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !(Object.keys(result.data).length > 0)) {
    throw new Error("No data found.");
  }

  return result.data.collections;
}

function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");

    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}

function transformCollectionsToTags(
  chainId: string,
  collections: Collection[]
): ContractTag[] {
  // First, filter and log invalid entries
  const validCollections: Collection[] = [];
  const rejectedCollections: string[] = [];

  collections.forEach((collection) => {
    const nftNameInvalid =
      containsHtmlOrMarkdown(collection.name) ||
      containsHtmlOrMarkdown(collection.symbol) ||
      containsHtmlOrMarkdown(collection.nftStandard) ||
      collection.symbol == null ||
      collection.name == null;

    if (nftNameInvalid) {
      rejectedCollections.push(JSON.stringify(collection));
    } else {
      validCollections.push(collection);
    }
  });

  // Log all rejected names
  if (rejectedCollections.length > 0) {
    console.log(
      "Rejected collections due to HTML/Markdown content:",
      rejectedCollections
    );
  }

  // Process valid collections into tags
  return validCollections.map((collection) => {
    const maxSymbolsLength = 35;
    const symbolsText = `${collection.name} (${collection.symbol})`;
    const truncatedSymbolsText = truncateString(symbolsText, maxSymbolsLength);

    return {
      "Contract Address": `eip155:${chainId}:${collection.id}`,
      "Public Name Tag": `${truncatedSymbolsText} NFT Collection`,
      "Project Name": "Opensea",
      "UI/Website Link": `https://opensea.io/assets/ethereum/${collection.id}`,
      "Public Note": `The ${collection.nftStandard} contract for the ${collection.name} (${collection.symbol}) NFT collection.`,
    };
  });
}

//The main logic for this module
class TagService implements ITagService {
  // Using an arrow function for returnTags
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let lastId: string = "0";
    let allTags: ContractTag[] = [];
    let isMore = true;
    let loop = 0;
    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const collections = await fetchData(url, lastId);
        allTags.push(...transformCollectionsToTags(chainId, collections));
        loop++;
        console.log(`First ${loop * 1000} entries queried...`);
        isMore = collections.length === 1000;
        if (isMore) {
          lastId = collections[collections.length - 1].id.toString();
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;
