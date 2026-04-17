export type TipoAlteracao =
  | 'preco'
  | 'imagem_principal'
  | 'imagens_secundarias'
  | 'titulo'
  | 'descricao'
  | 'ads'
  | 'estoque'
  | 'frete'
  | 'categoria'
  | 'variacoes'
  | 'desativacao'
  | 'reativacao'
  | 'outro';

export type ImpactoEsperado = 'alta' | 'queda' | 'neutro';

export interface Alteracao {
  id: string;
  data_alteracao: string;
  sku: string;
  tipo_alteracao: TipoAlteracao;
  loja: string | null;
  valor_antes: string | null;
  valor_depois: string | null;
  motivo: string | null;
  impacto_esperado: ImpactoEsperado | null;
  tags: string[] | null;
  observacao: string | null;
  responsavel: string | null;
  registrado_em: string;
}

export interface AlteracaoFormData {
  data_alteracao: string;
  sku: string;
  tipo_alteracao: TipoAlteracao;
  loja: string | null;
  valor_antes?: string;
  valor_depois?: string;
  motivo?: string;
  impacto_esperado?: ImpactoEsperado;
  tags?: string[];
  observacao?: string;
  responsavel?: string;
}

export interface AlteracoesFiltros {
  dataInicio: string | null;
  dataFim: string | null;
  sku: string;
  tipo: TipoAlteracao | '';
  loja: string;
}

export type PresetPeriodoAlteracoes = '7d' | '15d' | '30d' | 'mes' | 'personalizado';

export const TIPOS_ALTERACAO: { value: TipoAlteracao; label: string; icon: string }[] = [
  { value: 'preco', label: 'Preço', icon: '💰' },
  { value: 'imagem_principal', label: 'Imagem Principal', icon: '🖼️' },
  { value: 'imagens_secundarias', label: 'Imagens Secundárias', icon: '🖼️' },
  { value: 'titulo', label: 'Título', icon: '✏️' },
  { value: 'descricao', label: 'Descrição', icon: '📝' },
  { value: 'ads', label: 'Ads / Campanha', icon: '📢' },
  { value: 'estoque', label: 'Estoque', icon: '📦' },
  { value: 'frete', label: 'Frete', icon: '🚚' },
  { value: 'categoria', label: 'Categoria', icon: '🏷️' },
  { value: 'variacoes', label: 'Variações (cores/tamanhos)', icon: '🎨' },
  { value: 'desativacao', label: 'Desativação', icon: '⏸️' },
  { value: 'reativacao', label: 'Reativação', icon: '▶️' },
  { value: 'outro', label: 'Outro', icon: '🔧' },
];

export const MOTIVOS: string[] = [
  'Concorrência',
  'Margem',
  'Teste A/B',
  'Campanha',
  'Queima de estoque',
  'Reposição',
  'Sazonalidade',
  'Correção',
  'Outro',
];

export function labelTipo(tipo: TipoAlteracao): string {
  return TIPOS_ALTERACAO.find(t => t.value === tipo)?.label ?? tipo;
}

export function iconTipo(tipo: TipoAlteracao): string {
  return TIPOS_ALTERACAO.find(t => t.value === tipo)?.icon ?? '🔧';
}
