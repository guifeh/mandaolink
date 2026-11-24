import type { NicheConfig } from '../types.js';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fetchConfig(): Promise<NicheConfig> {
    const res = await fetch(`${this.baseUrl}/config`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Não autenticado. Por favor, faça login.');
      throw new Error(`Erro ao carregar configurações (HTTP ${res.status})`);
    }

    const data: NicheConfig = await res.json();
    if (data.horario_inicio) data.horario_inicio = data.horario_inicio.slice(0, 5);
    if (data.horario_fim) data.horario_fim = data.horario_fim.slice(0, 5);
    return data;
  }

  async updateConfig(partial: Partial<NicheConfig>): Promise<NicheConfig> {
    // Carrega configuração atual para garantir que propriedades obrigatórias não editadas sejam preservadas
    const current = await this.fetchConfig();
    const horarioInicio = (partial.horario_inicio ?? current.horario_inicio ?? '08:00').slice(0, 5);
    const horarioFim = (partial.horario_fim ?? current.horario_fim ?? '22:00').slice(0, 5);
    const payload: NicheConfig = {
      nome: partial.nome ?? current.nome ?? 'Carro',
      palavras_chave: partial.palavras_chave ?? current.palavras_chave ?? [],
      palavras_bloqueadas: partial.palavras_bloqueadas ?? current.palavras_bloqueadas ?? [],
      categorias: partial.categorias ?? current.categorias ?? [],
      tag_amazon: partial.tag_amazon !== undefined ? partial.tag_amazon : (current.tag_amazon ?? ''),
      limite_hora: partial.limite_hora ?? current.limite_hora ?? 5,
      limite_dia: partial.limite_dia ?? current.limite_dia ?? 30,
      horario_inicio: horarioInicio,
      horario_fim: horarioFim,
    };

    const res = await fetch(`${this.baseUrl}/config`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro ?? `Erro ao salvar configurações (HTTP ${res.status})`);
    }

    const saved: NicheConfig = await res.json();
    if (saved.horario_inicio) saved.horario_inicio = saved.horario_inicio.slice(0, 5);
    if (saved.horario_fim) saved.horario_fim = saved.horario_fim.slice(0, 5);
    return saved;
  }

  async requestMagicLink(email: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/link`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro ?? 'Falha ao solicitar link de acesso.');
    }

    const data = await res.json();
    return data.mensagem;
  }

  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/auth/sair`, {
      method: 'POST',
      credentials: 'include',
    });
  }
}

export const api = new ApiClient();
