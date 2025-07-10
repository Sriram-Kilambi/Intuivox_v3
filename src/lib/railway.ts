import { encrypt, decrypt } from "./encryption";

// Railway API types
export interface RailwayProject {
  id: string;
  name: string;
  description?: string;
  teamId?: string;
}

export interface RailwayService {
  id: string;
  name: string;
  projectId: string;
}

export interface RailwayDeployment {
  id: string;
  serviceId: string;
  status:
    | "QUEUED"
    | "BUILDING"
    | "DEPLOYING"
    | "SUCCESS"
    | "FAILED"
    | "CRASHED";
  url?: string;
  createdAt: string;
  buildLogs?: string;
}

export interface RailwayDomain {
  id: string;
  domain: string;
  serviceId: string;
  status: "PENDING" | "ACTIVE" | "FAILED";
}

// Railway GraphQL queries
const RAILWAY_GRAPHQL_ENDPOINT = "https://backboard.railway.app/graphql/v2";

class RailwayAPI {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async graphqlRequest(query: string, variables: any = {}) {
    const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Railway API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`Railway GraphQL error: ${data.errors[0].message}`);
    }

    return data.data;
  }

  // Create a new Railway project
  async createProject(
    name: string,
    description?: string
  ): Promise<RailwayProject> {
    const query = `
      mutation ProjectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          id
          name
          description
        }
      }
    `;

    const variables = {
      input: {
        name,
        description: description || `Deployed from Intuivox - ${name}`,
        isPublic: false,
      },
    };

    const data = await this.graphqlRequest(query, variables);
    return data.projectCreate;
  }

  // Create a service within a project
  async createService(
    projectId: string,
    name: string
  ): Promise<RailwayService> {
    const query = `
      mutation ServiceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
          projectId
        }
      }
    `;

    const variables = {
      input: {
        projectId,
        name,
        source: {
          image: "node:18-alpine", // We'll override this with actual deployment
        },
      },
    };

    const data = await this.graphqlRequest(query, variables);
    return data.serviceCreate;
  }

  // Deploy source code to a service
  async deployToService(
    serviceId: string,
    files: Record<string, string>
  ): Promise<RailwayDeployment> {
    // Convert files to Railway's expected format
    const sourceFiles = Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content).toString("base64"),
    }));

    const query = `
      mutation ServiceInstanceDeploy($input: ServiceInstanceDeployInput!) {
        serviceInstanceDeploy(input: $input) {
          id
          status
          url
          createdAt
        }
      }
    `;

    const variables = {
      input: {
        serviceId,
        source: {
          repo: {
            files: sourceFiles,
          },
        },
        builder: "NIXPACKS", // Railway's auto-detect builder
      },
    };

    const data = await this.graphqlRequest(query, variables);
    return data.serviceInstanceDeploy;
  }

  // Get deployment status
  async getDeploymentStatus(deploymentId: string): Promise<RailwayDeployment> {
    const query = `
      query DeploymentGet($id: String!) {
        deployment(id: $id) {
          id
          status
          url
          createdAt
          buildLogs
        }
      }
    `;

    const data = await this.graphqlRequest(query, { id: deploymentId });
    return data.deployment;
  }

  // Add custom domain to service
  async addCustomDomain(
    serviceId: string,
    domain: string
  ): Promise<RailwayDomain> {
    const query = `
      mutation CustomDomainCreate($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          status
        }
      }
    `;

    const variables = {
      input: {
        serviceId,
        domain,
      },
    };

    const data = await this.graphqlRequest(query, variables);
    return data.customDomainCreate;
  }

  // Get service URL
  async getServiceUrl(serviceId: string): Promise<string | null> {
    const query = `
      query ServiceGet($id: String!) {
        service(id: $id) {
          id
          domains {
            domain
          }
        }
      }
    `;

    const data = await this.graphqlRequest(query, { id: serviceId });
    const service = data.service;

    if (service.domains && service.domains.length > 0) {
      return `https://${service.domains[0].domain}`;
    }

    return null;
  }

  // Get build logs
  async getBuildLogs(deploymentId: string): Promise<string> {
    const query = `
      query DeploymentLogs($id: String!) {
        deployment(id: $id) {
          buildLogs
        }
      }
    `;

    const data = await this.graphqlRequest(query, { id: deploymentId });
    return data.deployment.buildLogs || "";
  }
}

// Utility functions
export async function createRailwayAPI(userId: string): Promise<RailwayAPI> {
  const { prisma } = await import("./db");

  const connection = await prisma.userRailwayConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    throw new Error(
      "Railway connection not found. Please connect your Railway account first."
    );
  }

  const decryptedToken = decrypt(connection.accessToken);
  return new RailwayAPI(decryptedToken);
}

// Deploy fragment to Railway
export async function deployFragmentToRailway(
  userId: string,
  fragmentId: string,
  customDomain?: string
): Promise<{
  projectId: string;
  serviceId: string;
  deploymentId: string;
  deploymentUrl: string;
}> {
  const { prisma } = await import("./db");

  // Get fragment data
  const fragment = await prisma.fragment.findUnique({
    where: { id: fragmentId },
    include: { project: true },
  });

  if (!fragment) {
    throw new Error("Fragment not found");
  }

  if (fragment.project.userId !== userId) {
    throw new Error("Unauthorized: Fragment does not belong to user");
  }

  // Create Railway API client
  const railway = await createRailwayAPI(userId);

  // Generate project name
  const projectName = `${
    fragment.title?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "app"
  }-${Date.now()}`;

  try {
    // 1. Create Railway project
    const project = await railway.createProject(
      projectName,
      `Deployed from Intuivox - ${fragment.title}`
    );

    // 2. Create service within project
    const service = await railway.createService(project.id, "web");

    // 3. Deploy files to service
    const deployment = await railway.deployToService(
      service.id,
      fragment.files as Record<string, string>
    );

    // 4. Wait a moment for URL to be available
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 5. Get service URL
    const deploymentUrl =
      (await railway.getServiceUrl(service.id)) ||
      `https://${service.id}.up.railway.app`;

    // 6. Add custom domain if provided
    if (customDomain) {
      await railway.addCustomDomain(service.id, customDomain);
    }

    return {
      projectId: project.id,
      serviceId: service.id,
      deploymentId: deployment.id,
      deploymentUrl,
    };
  } catch (error) {
    console.error("Railway deployment error:", error);
    throw new Error(
      `Deployment failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// Poll deployment status until complete
export async function pollDeploymentStatus(
  userId: string,
  deploymentId: string,
  onUpdate?: (status: RailwayDeployment) => void
): Promise<RailwayDeployment> {
  const railway = await createRailwayAPI(userId);
  const maxAttempts = 60; // 5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    const deployment = await railway.getDeploymentStatus(deploymentId);

    if (onUpdate) {
      onUpdate(deployment);
    }

    if (deployment.status === "SUCCESS" || deployment.status === "FAILED") {
      return deployment;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
    attempts++;
  }

  throw new Error("Deployment polling timeout");
}
