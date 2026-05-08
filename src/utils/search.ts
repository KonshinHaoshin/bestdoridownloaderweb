import { CHARACTER_ALIASES } from '../data/characterAliases';
import { CharaRoster } from '../types';

type CostumeSearchInfo = {
  description: string[];
};

type MatchKind = 'character' | 'costume' | 'model';

type SearchRecord = {
  model: string;
  charaId: string;
  label: string;
  modelTokens: string[];
  characterTokens: string[];
  costumeTokens: string[];
  combinedTokens: string[];
};

type ScoredMatch = {
  record: SearchRecord;
  kind: MatchKind;
  score: number;
};

export type Live2dSearchResult = {
  models: string[];
  label: string;
  kind: MatchKind;
};

const punctuationPattern = /[\s・･·._\-—–/\\|()[\]{}"'`~!！?？:：;；,，。、]+/g;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(punctuationPattern, '');
}

const uniqueStrings = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));

const normalizedTokens = (tokens: string[]) => uniqueStrings(tokens.map(normalizeSearchText).filter(Boolean));

const getCharaId = (model: string) => String(parseInt(model.slice(0, 3), 10));

const buildRecords = (
  roster: CharaRoster,
  assets: Record<string, unknown>,
  costumeByAsset: Map<string, CostumeSearchInfo>
): SearchRecord[] => {
  return Object.keys(assets)
    .filter((model) => !model.endsWith('general'))
    .map((model) => {
      const charaId = getCharaId(model);
      const chara = roster[charaId];
      const names = uniqueStrings([...(chara?.characterName || []), ...((chara?.nickname || []).filter(Boolean) as string[])]);
      const aliases = CHARACTER_ALIASES[charaId] || [];
      const costumeNames = uniqueStrings(costumeByAsset.get(model)?.description || []);
      const characterTokens = uniqueStrings([charaId, model.slice(0, 3), ...names, ...aliases]);
      const combinedTokens = uniqueStrings(
        [...names, ...aliases].flatMap((name) => costumeNames.map((costume) => `${name}${costume}`))
      );

      return {
        model,
        charaId,
        label: names[0] || aliases[0] || model.slice(0, 3),
        modelTokens: normalizedTokens([model]),
        characterTokens: normalizedTokens(characterTokens),
        costumeTokens: normalizedTokens(costumeNames),
        combinedTokens: normalizedTokens(combinedTokens),
      };
    });
};

const scoreTokens = (tokens: string[], query: string, exact: number, startsWith: number, contains: number) => {
  if (tokens.some((token) => token === query)) return exact;
  if (query.length >= 2 && tokens.some((token) => token.startsWith(query))) return startsWith;
  if (query.length >= 2 && tokens.some((token) => token.includes(query))) return contains;
  if (tokens.some((token) => token.length >= 2 && query.includes(token))) return contains - 5;
  return 0;
};

const scoreRecord = (record: SearchRecord, query: string): ScoredMatch | null => {
  const candidates: Array<{ kind: MatchKind; score: number }> = [
    { kind: 'model', score: scoreTokens(record.modelTokens, query, 100, 84, 76) },
    { kind: 'character', score: scoreTokens(record.characterTokens, query, 96, 88, 72) },
    { kind: 'costume', score: scoreTokens(record.costumeTokens, query, 82, 70, 60) },
    { kind: 'costume', score: scoreTokens(record.combinedTokens, query, 78, 66, 56) },
  ];
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score <= 0) return null;
  return { record, kind: best.kind, score: best.score };
};

export function searchLive2dModels(params: {
  roster: CharaRoster;
  assets: Record<string, unknown>;
  costumeByAsset: Map<string, CostumeSearchInfo>;
  query: string;
}): Live2dSearchResult | null {
  const query = normalizeSearchText(params.query);
  if (!query) return null;

  const records = buildRecords(params.roster, params.assets, params.costumeByAsset);
  const matches = records
    .map((record) => scoreRecord(record, query))
    .filter(Boolean)
    .sort((a, b) => {
      if (b!.score !== a!.score) return b!.score - a!.score;
      return a!.record.model.localeCompare(b!.record.model);
    }) as ScoredMatch[];

  if (matches.length === 0) return null;

  const best = matches[0];

  if (best.kind === 'character') {
    const models = records
      .filter((record) => record.charaId === best.record.charaId)
      .map((record) => record.model)
      .sort();
    return { models, label: best.record.label, kind: 'character' };
  }

  const modelMatches = matches.filter((match) => match.kind === best.kind);
  const models = Array.from(new Set(modelMatches.map((match) => match.record.model))).sort();
  const sameCharacter = modelMatches.every((match) => match.record.charaId === best.record.charaId);
  const label =
    best.kind === 'model'
      ? `${best.record.label}（匹配 ${models.length} 个模型）`
      : sameCharacter
        ? `${best.record.label}（匹配 ${models.length} 套）`
        : `匹配 ${models.length} 套模型`;

  return { models, label, kind: best.kind };
}
