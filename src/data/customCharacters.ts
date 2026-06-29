import type { CharaRoster } from '../types';

type CustomCharacterEntry = {
  id: string;
  names: string[];
  aliases?: string[];
};

const emptyNicknames: (string | null)[] = [null, null, null, null, null];

export const CUSTOM_CHARACTER_ENTRIES: CustomCharacterEntry[] = [
  { id: '201', names: ['月岛麻里奈'], aliases: ['月島まりな', 'まりな', 'marina'] },
  { id: '209', names: ['明棕色双马尾小女孩'], aliases: ['hhw主线生病小孩', '生病小孩', '双马尾小女孩'] },
  { id: '210', names: ['美竹兰父亲'], aliases: ['兰父亲', '美竹蘭父親'] },
  { id: '211', names: ['弦卷心黑衣侍卫三人组'], aliases: ['黑衣侍卫', '侍卫三人组', '弦卷心侍卫'] },
  { id: '212', names: ['友希那父亲'], aliases: ['ykn爸爸'] },
  { id: '213', names: ['步美'], aliases: ['彩彩的偶像', '彩彩引路人', 'marmalade的C位', 'marmalade'] },
  { id: '214', names: ['明日香'], aliases: ['高祖妹妹明日香', '高祖妹妹'] },
  { id: '215', names: ['都筑诗船'], aliases: ['邦太祖都筑诗船', '邦太祖'] },
  { id: '216', names: ['雏子'], aliases: ['十二骑雏子', 'Glitter*Green鼓手', 'glitter green鼓手'] },
  { id: '217', names: ['玛丽•安德罗美亚'], aliases: ['破旧紫兔子', '等身皮套', '绯玛丽机甲'] },
  { id: '218', names: ['芹泽澪'], aliases: ['生芹泽澪', 'PP公司新出道偶像团队长', '偶像团队长'] },
  { id: '219', names: ['山濑濑理奈'], aliases: ['PP公司新出道偶像团成员', '偶像团成员'] },
  { id: '220', names: ['小金井志乃'], aliases: ['PP公司新出道偶像团成员', '偶像团成员'] },
  { id: '221', names: ['腐烂秀秀经纪人'], aliases: ['秀秀经纪人'] },
  { id: '222', names: ['晴海'], aliases: ['R组经纪人', 'Roselia经纪人'] },
  { id: '225', names: ['真次凛凛子'], aliases: ['凛凛子'] },
  { id: '226', names: ['奈绪'], aliases: ['PP制作人', '制作人'] },
  { id: '227', names: ['月之森理事长'], aliases: ['理事长'] },
  { id: '228', names: ['夏洛特'], aliases: ['弦卷心宿敌', '心宿敌'] },
  { id: '302', names: ['百合'], aliases: ['里美姐姐', '邦高祖引路人', 'Glitter*Green队长', 'glitter green队长'] },
  { id: '304', names: ['海野夏希'], aliases: ['saya老队友', 'chispa队长', '吉他主唱'] },
  { id: '305', names: ['会动的小企鹅'], aliases: ['小企鹅'] },
  { id: '307', names: ['小邦高祖'], aliases: ['邦高祖小'] },
  { id: '308', names: ['小hagumi'], aliases: ['小育美', 'hagumi小'] },
  { id: '309', names: ['rinrin and ykn泳装'], aliases: ['rinrin泳装', 'ykn泳装', '双人模型'] },
  { id: '310', names: ['小兰'], aliases: ['兰小'] },
  { id: '311', names: ['小摩卡'], aliases: ['摩卡小'] },
  { id: '313', names: ['小巴'], aliases: ['巴小'] },
  { id: '314', names: ['小茨菇'], aliases: ['茨菇小'] },
  { id: '315', names: ['小rinrin'], aliases: ['rinrin小'] },
  { id: '316', names: ['会动的地鼠 小咕咕'], aliases: ['会动的地鼠', '小咕咕', '地鼠'] },
  { id: '318', names: ['小友希那'], aliases: ['小凑友希那'] },
  { id: '319', names: ['小莉莎'], aliases: ['小今井莉莎'] },
  { id: '320', names: ['chisato小'], aliases: ['小chisato'] },
  { id: '321', names: ['kaoru小'], aliases: ['小kaoru'] },
  { id: '326', names: ['小纱夜'], aliases: ['小冰川纱夜'] },
  { id: '327', names: ['小日菜'], aliases: ['小冰川日菜'] },
  { id: '328', names: ['妮可莉娜'], aliases: ['快乐国公主', '和花音一模一样', '花音一模一样'] },
  { id: '330', names: ['otae小'], aliases: ['小otae'] },
  { id: '331', names: ['小layer'], aliases: ['layer小'] },
  { id: '332', names: ['arisa小'], aliases: ['小arisa', '有咲小', '小有咲'] },
  { id: '333', names: ['小chuchu'], aliases: ['chuchu小'] },
  { id: '334', names: ['小琉唯'], aliases: ['琉唯小'] },
  { id: '335', names: ['真白史莱姆'], aliases: ['ましろスライム', '真白史萊姆', '史莱姆'] },
  { id: '336', names: ['哥布林'], aliases: ['ゴブリン', 'goblin'] },
  { id: '342', names: ['小亚子'], aliases: ['亚子小'] },

  // Ave Mujica entries may be missing from older Bestdori character data.
  { id: '337', names: ['三角 初華', 'Uika Misumi', '三角 初华'], aliases: ['三角初华', '三角初華', '初华', '初華', 'uika', 'misumi uika'] },
  { id: '338', names: ['若葉 睦', 'Mutsumi Wakaba', '若叶 睦'], aliases: ['若叶睦', '若葉睦', '睦', 'mutsumi', 'wakaba mutsumi'] },
  { id: '339', names: ['八幡 海鈴', 'Umiri Yahata', '八幡 海铃'], aliases: ['八幡海铃', '八幡海鈴', '海铃', '海鈴', 'umiri', 'yahata umiri'] },
  { id: '340', names: ['祐天寺 にゃむ', 'Nyamu Yūtenji', '祐天寺 若麦', '祐天寺 喵梦'], aliases: ['祐天寺若麦', '祐天寺若麥', '祐天寺喵梦', '喵梦', '喵夢', '若麦', '若麥', 'nyamu', 'yutenji nyamu'] },
  { id: '341', names: ['豊川 祥子', 'Sakiko Togawa', '丰川祥子'], aliases: ['丰川祥子', '豐川祥子', '豊川祥子', '祥子', 'sakiko', 'togawa sakiko'] },
];

export const CUSTOM_CHARA_ROSTER: CharaRoster = Object.fromEntries(
  CUSTOM_CHARACTER_ENTRIES.map((entry) => [
    entry.id,
    {
      characterType: 'common',
      characterName: entry.names,
      nickname: emptyNicknames,
    },
  ])
) as CharaRoster;

export const CUSTOM_CHARACTER_ALIASES: Record<string, string[]> = Object.fromEntries(
  CUSTOM_CHARACTER_ENTRIES.map((entry) => [entry.id, [...entry.names, ...(entry.aliases || [])]])
);
