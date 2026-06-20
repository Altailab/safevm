// Thin Hetzner Cloud API v1 client (REST + Bearer token). No external deps.
// Docs: https://docs.hetzner.cloud/

const API = "https://api.hetzner.cloud/v1";

export class HCloud {
  constructor(private token: string) {
    if (!token) throw new Error("HCLOUD_TOKEN is required");
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(`hcloud ${method} ${path} -> ${res.status}: ${text}`);
    }
    return json;
  }

  // --- SSH keys ---------------------------------------------------------
  async ensureSshKey(name: string, publicKey: string): Promise<number> {
    const { ssh_keys } = await this.req("GET", `/ssh_keys?name=${encodeURIComponent(name)}`);
    if (ssh_keys?.length) return ssh_keys[0].id;
    const { ssh_key } = await this.req("POST", "/ssh_keys", { name, public_key: publicKey });
    return ssh_key.id;
  }

  // --- Servers ----------------------------------------------------------
  async findServer(name: string): Promise<any | null> {
    const { servers } = await this.req("GET", `/servers?name=${encodeURIComponent(name)}`);
    return servers?.[0] ?? null;
  }

  async createServer(opts: {
    name: string;
    serverType: string;
    image: string;
    location: string;
    sshKeyId: number;
    userData?: string;
  }): Promise<any> {
    const { server } = await this.req("POST", "/servers", {
      name: opts.name,
      server_type: opts.serverType,
      image: opts.image,
      location: opts.location,
      ssh_keys: [opts.sshKeyId],
      user_data: opts.userData,
      start_after_create: true,
      public_net: { enable_ipv4: true, enable_ipv6: true },
    });
    return server;
  }

  async getServer(id: number): Promise<any> {
    const { server } = await this.req("GET", `/servers/${id}`);
    return server;
  }

  async deleteServer(id: number): Promise<void> {
    await this.req("DELETE", `/servers/${id}`);
  }

  async waitForRunning(id: number, timeoutMs = 180_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this.getServer(id);
      const ip = s?.public_net?.ipv4?.ip;
      if (s.status === "running" && ip) return ip;
      await Bun.sleep(4000);
    }
    throw new Error(`server ${id} not running within timeout`);
  }
}
