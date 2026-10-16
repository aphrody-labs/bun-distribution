/** Generated SQL-independent Cross metadata. */
export default {
  AffinityRankMaster: {
    file: "LGAマスター - 信頼度ランク.tsv",
    fullName: "Soccer.Shared.AffinityRankMaster",
    extends: null,
    columns: [
      {
        name: "AffinityRank",
        type: "int",
        kind: "int",
      },
      {
        name: "RequiredAffinity",
        type: "int",
        kind: "int",
      },
    ],
  },
  AffinityRewardMaster: {
    file: "LGAマスター - 信頼度報酬.tsv",
    fullName: "Soccer.Shared.AffinityRewardMaster",
    extends: null,
    columns: [
      {
        name: "ClubMemberCode",
        type: "int",
        kind: "int",
      },
      {
        name: "AffinityRank",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
    ],
  },
  AwakeningTierMaster: {
    file: "LGAマスター - 覚醒度.tsv",
    fullName: "Soccer.Shared.AwakeningTierMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "KickMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "TechniqueMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "BlockMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "CatchMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "SpeedMultiplier",
        type: "decimal",
        kind: "float",
      },
    ],
  },
  BackgroundMaster: {
    file: "LGAマスター - 背景.tsv",
    fullName: "Soccer.Shared.BackgroundMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "ScenePath",
        type: "string",
        kind: "string",
      },
      {
        name: "GoalPostPath",
        type: "string",
        kind: "string",
      },
      {
        name: "SoccerBattleGoalPostPath",
        type: "string",
        kind: "string",
      },
    ],
  },
  BattleBgmMaster: {
    file: "LGAマスター - 試合BGM.tsv",
    fullName: "Soccer.Shared.BattleBgmMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "FirstHalfRequest",
        type: "SoundPlayRequest",
        kind: "struct",
      },
      {
        name: "SecondHalfRequest",
        type: "SoundPlayRequest",
        kind: "struct",
      },
      {
        name: "AlmostFinishRequest",
        type: "SoundPlayRequest",
        kind: "struct",
      },
    ],
  },
  BattleOperationParameter: {
    file: "LGAマスター - AI共通設定.tsv",
    fullName: "Soccer.Shared.BattleOperationParameter",
    extends: null,
    columns: [
      {
        name: "FarthestPassTargetBonus",
        type: "int",
        kind: "int",
      },
      {
        name: "AroundEnemyPenalty",
        type: "int",
        kind: "int",
      },
      {
        name: "AroundEnemyBonus",
        type: "int",
        kind: "int",
      },
      {
        name: "FarFrontThreshold",
        type: "int",
        kind: "int",
      },
      {
        name: "FarFrontBonus",
        type: "int",
        kind: "int",
      },
      {
        name: "FrontBonus",
        type: "int",
        kind: "int",
      },
      {
        name: "FarBackThreshold",
        type: "int",
        kind: "int",
      },
      {
        name: "BackBonus",
        type: "int",
        kind: "int",
      },
      {
        name: "FarBackPenalty",
        type: "int",
        kind: "int",
      },
    ],
  },
  BattlePassLevelMaster: {
    file: "LGAマスター - バトルパスレベル.tsv",
    fullName: "Soccer.Shared.BattlePassLevelMaster",
    extends: null,
    columns: [
      {
        name: "BattlePassCode",
        type: "int",
        kind: "int",
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "BattlePass",
        type: "BattlePassMaster",
        kind: "ref",
        ref: "BattlePassMaster",
      },
      {
        name: "NormalRewardTable",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "PremiumRewardTable",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "IsPickup",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  BattlePassMaster: {
    file: "LGAマスター - バトルパス.tsv",
    fullName: "Soccer.Shared.BattlePassMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "DailyMissionGroup",
        type: "BattlePassMissionGroupMaster",
        kind: "ref",
        ref: "BattlePassMissionGroupMaster",
      },
      {
        name: "PermanentMissionGroup",
        type: "BattlePassMissionGroupMaster",
        kind: "ref",
        ref: "BattlePassMissionGroupMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
      },
      {
        name: "Levels",
        type: "BattlePassLevelMaster[]",
        kind: "array",
        ref: "BattlePassLevelMaster",
        element: "BattlePassLevelMaster",
      },
      {
        name: "BackgroundAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "PremiumBannerAssetName",
        type: "string",
        kind: "string",
      },
    ],
  },
  BonusPassMaster: {
    file: "LGAマスター - ストア - ボーナスパス.tsv",
    fullName: "Soccer.Shared.BonusPassMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "DurationDays",
        type: "int",
        kind: "int",
      },
      {
        name: "DailyItemTable",
        type: "StoreItemTableMaster",
        kind: "ref",
        ref: "StoreItemTableMaster",
      },
      {
        name: "InAppProduct",
        type: "InAppLinkProductMaster",
        kind: "ref",
        ref: "InAppLinkProductMaster",
      },
      {
        name: "ExternalProduct",
        type: "ExternalLinkProductMaster",
        kind: "ref",
        ref: "ExternalLinkProductMaster",
      },
    ],
  },
  CharacterGradeMaster: {
    file: "LGAマスター - グレード.tsv",
    fullName: "Soccer.Shared.CharacterGradeMaster",
    extends: null,
    columns: [
      {
        name: "Grade",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "StartAwakeningTierCode",
        type: "int",
        kind: "int",
      },
      {
        name: "AwakeningTierMaterial",
        type: "Dictionary<Int32, AwakeningTierMaterialMaster>",
        kind: "dict",
        ref: "AwakeningTierMaterialMaster",
        key: "int",
        value: "AwakeningTierMaterialMaster",
      },
    ],
    relatedFiles: ["LGAマスター - グレード.tsv", "LGAマスター - 覚醒素材テーブル.tsv"],
  },
  CharacterMaster: {
    file: "LGAマスター - キャラクター.tsv",
    fullName: "Soccer.Shared.CharacterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "NicknameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "SubNameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "CharacterIconCode",
        type: "int",
        kind: "int",
      },
      {
        name: "Element",
        type: "CharacterElement",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Wind",
            value: "1",
          },
          {
            name: "Forest",
            value: "2",
          },
          {
            name: "Fire",
            value: "3",
          },
          {
            name: "Mountain",
            value: "4",
          },
        ],
      },
      {
        name: "PreferredPosition",
        type: "CharacterPosition",
        kind: "enum",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
      },
      {
        name: "FaceCode",
        type: "int",
        kind: "int",
      },
      {
        name: "Shape",
        type: "CharacterShape",
        kind: "enum",
        enumValues: [
          {
            name: "Undefined",
            value: "0",
          },
          {
            name: "MaleAverage",
            value: "1",
          },
          {
            name: "MaleSmall",
            value: "2",
          },
          {
            name: "MaleFat",
            value: "3",
          },
          {
            name: "MaleTall",
            value: "4",
          },
          {
            name: "MaleMuscular",
            value: "5",
          },
          {
            name: "MaleLarge",
            value: "6",
          },
          {
            name: "MaleTallAndMuscular",
            value: "7",
          },
          {
            name: "MaleMuscularThickNeck",
            value: "8",
          },
          {
            name: "MaleLargeThickNeck",
            value: "9",
          },
          {
            name: "FemaleAverage",
            value: "10",
          },
          {
            name: "FemaleSmall",
            value: "11",
          },
          {
            name: "FemaleFat",
            value: "12",
          },
          {
            name: "FemaleTall",
            value: "13",
          },
          {
            name: "FemaleMuscular",
            value: "14",
          },
          {
            name: "FemaleLarge",
            value: "15",
          },
          {
            name: "FemaleTallAndMuscular",
            value: "16",
          },
          {
            name: "FemaleMuscularThickNeck",
            value: "17",
          },
          {
            name: "FemaleLargeThickNeck",
            value: "18",
          },
        ],
      },
      {
        name: "Personality",
        type: "CharacterPersonality",
        kind: "enum",
        enumValues: [
          {
            name: "Daring",
            value: "0",
          },
          {
            name: "Cool",
            value: "1",
          },
          {
            name: "Cheerful",
            value: "2",
          },
          {
            name: "Elegant",
            value: "3",
          },
        ],
      },
      {
        name: "Gender",
        type: "CharacterGender",
        kind: "enum",
        enumValues: [
          {
            name: "Unspecified",
            value: "0",
          },
          {
            name: "Male",
            value: "1",
          },
          {
            name: "Female",
            value: "2",
          },
        ],
      },
      {
        name: "ChestSize",
        type: "CharacterChestSize",
        kind: "enum",
        enumValues: [
          {
            name: "Medium",
            value: "0",
          },
          {
            name: "Small",
            value: "1",
          },
          {
            name: "Large",
            value: "2",
          },
        ],
        nullable: true,
      },
      {
        name: "Growths",
        type: "Dictionary<Int32, CharacterGrowthMaster>",
        kind: "dict",
        ref: "CharacterGrowthMaster",
        key: "int",
        value: "CharacterGrowthMaster",
      },
      {
        name: "LevelAcquisitions",
        type: "CharacterLevelAcquisitionMaster[]",
        kind: "array",
        ref: "CharacterLevelAcquisitionMaster",
        element: "CharacterLevelAcquisitionMaster",
      },
      {
        name: "AwakeningGrowths",
        type: "CharacterAwakeningGrowthMaster[]",
        kind: "array",
        ref: "CharacterAwakeningGrowthMaster",
        element: "CharacterAwakeningGrowthMaster",
      },
      {
        name: "Tags",
        type: "CharacterTagMaster[]",
        kind: "array",
        ref: "CharacterTagMaster",
        element: "CharacterTagMaster",
      },
      {
        name: "CharacterItemMaster",
        type: "CharacterItemMaster",
        kind: "ref",
        ref: "CharacterItemMaster",
      },
      {
        name: "SoulItemMaster",
        type: "CharacterSoulItemMaster",
        kind: "ref",
        ref: "CharacterSoulItemMaster",
      },
      {
        name: "GradeMaster",
        type: "CharacterGradeMaster",
        kind: "ref",
        ref: "CharacterGradeMaster",
      },
      {
        name: "FieldAreaCodeToPreferredArea",
        type: "Dictionary<Int32, PreferredAreaRankMaster>",
        kind: "dict",
        ref: "PreferredAreaRankMaster",
        key: "int",
        value: "PreferredAreaRankMaster",
      },
      {
        name: "Timeline",
        type: "CharacterTimelineMaster",
        kind: "ref",
        ref: "CharacterTimelineMaster",
      },
      {
        name: "VoiceCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DefaultModelSet",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
      {
        name: "ModelVariations",
        type: "CharacterModelVariationMaster[]",
        kind: "array",
        ref: "CharacterModelVariationMaster",
        element: "CharacterModelVariationMaster",
      },
      {
        name: "PreferStandingCollar",
        type: "bool",
        kind: "bool",
      },
      {
        name: "PreferShirtOut",
        type: "bool",
        kind: "bool",
      },
      {
        name: "ShapeCorrectionCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "NameOnUniform",
        type: "string",
        kind: "string",
      },
      {
        name: "DefaultUniformNumber",
        type: "int",
        kind: "int",
      },
      {
        name: "ModifierPassiveLotteryTable",
        type: "ModifierPassiveLotteryTableMaster",
        kind: "ref",
        ref: "ModifierPassiveLotteryTableMaster",
      },
    ],
    relatedFiles: [
      "LGAマスター - キャラクター.tsv",
      "LGAマスター - キャラクター - 成長パターン.tsv",
      "LGAマスター - キャラクター - レベル習得.tsv",
      "LGAマスター - キャラクター - 覚醒習得.tsv",
      "LGAマスター - キャラクター - レベルオファー.tsv",
      "LGAマスター - キャラクター - 得意エリア.tsv",
      "LGAマスター - キャラクター - タイムライン.tsv",
    ],
  },
  CharacterModelSetMaster: {
    file: "LGAマスター - キャラクターモデルセット.tsv",
    fullName: "Soccer.Shared.CharacterModelSetMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "UniformCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SkinCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "GloveCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "ShoesCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "AccessoryCodes",
        type: "Int32[]",
        kind: "array",
        element: "int",
      },
      {
        name: "UniformNumberCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "CaptainMarkCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "ShirtOutOverride",
        type: "bool",
        kind: "bool",
        nullable: true,
      },
      {
        name: "CanApplyShapeCorrection",
        type: "bool",
        kind: "bool",
      },
      {
        name: "HasUniformName",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  CharacterModelVariationMaster: {
    file: "LGAマスター - 固有着こなし.tsv",
    fullName: "Soccer.Shared.CharacterModelVariationMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Source",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
      {
        name: "FaceCodeOverride",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "Variation",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
    ],
  },
  CharacterTagMaster: {
    file: "LGAマスター - キャラクター - タグ.tsv",
    fullName: "Soccer.Shared.CharacterTagMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Label",
        type: "string",
        kind: "string",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
      },
    ],
  },
  ChatStampMaster: {
    file: "LGAマスター - チャットスタンプ.tsv",
    fullName: "Soccer.Shared.ChatStampMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "AssetName",
        type: "string",
        kind: "string",
      },
    ],
  },
  ClubHouseDecorationSlotTypeMaster: {
    file: "LGAマスター - 部室配置品スロットタイプ設定.tsv",
    fullName: "Soccer.Shared.ClubHouseDecorationSlotTypeMaster",
    extends: null,
    columns: [
      {
        name: "IndexKey",
        type: "ClubHouseDecorationIndexKey",
        kind: "struct",
      },
      {
        name: "PlaceMinCount",
        type: "int",
        kind: "int",
      },
      {
        name: "PlaceMaxCount",
        type: "int",
        kind: "int",
      },
    ],
  },
  ClubMemberOperationProfileMaster: {
    file: "LGAマスター - キャラクターAI命令セット.tsv",
    fullName: "Soccer.Shared.ClubMemberOperationProfileMaster",
    extends: null,
    columns: [
      {
        name: "CharacterCode",
        type: "int",
        kind: "int",
      },
      {
        name: "FWOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "MFOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DFOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "GKOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SoccerBattleFWOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SoccerBattleMFOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SoccerBattleDFOperationProfileCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SoccerBattleGKOperationProfileCode",
        type: "int",
        kind: "int",
      },
    ],
  },
  CommentaryMaster: {
    file: "LGAマスター - 試合実況者.tsv",
    fullName: "Soccer.Shared.CommentaryMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "AppearanceName",
        type: "string",
        kind: "string",
      },
    ],
  },
  ConnectionBoardAreaMaster: {
    file: "LGAマスター - 人脈ボードエリア.tsv",
    fullName: "Soccer.Shared.ConnectionBoardAreaMaster",
    extends:
      "StoryBoardAreaMaster<ConnectionBoardAreaMaster, ConnectionBoardStageMaster, ConnectionBoardChapterMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Stages",
        type: "ConnectionBoardStageMaster[]",
        kind: "array",
        ref: "ConnectionBoardStageMaster",
        element: "ConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "MapAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Chapter",
        type: "ConnectionBoardChapterMaster",
        kind: "ref",
        ref: "ConnectionBoardChapterMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Prev",
        type: "ConnectionBoardAreaMaster",
        kind: "ref",
        ref: "ConnectionBoardAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Next",
        type: "ConnectionBoardAreaMaster",
        kind: "ref",
        ref: "ConnectionBoardAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FirstMainStages",
        type: "ConnectionBoardStageMaster[]",
        kind: "array",
        ref: "ConnectionBoardStageMaster",
        element: "ConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FinalMainStages",
        type: "ConnectionBoardStageMaster[]",
        kind: "array",
        ref: "ConnectionBoardStageMaster",
        element: "ConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "RequiredConnectionBoardStageToUnlock",
        type: "ConnectionBoardStageMaster",
        kind: "ref",
        ref: "ConnectionBoardStageMaster",
      },
    ],
  },
  ConnectionBoardChapterMaster: {
    file: "LGAマスター - 人脈ボードチャプター.tsv",
    fullName: "Soccer.Shared.ConnectionBoardChapterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Areas",
        type: "ConnectionBoardAreaMaster[]",
        kind: "array",
        ref: "ConnectionBoardAreaMaster",
        element: "ConnectionBoardAreaMaster",
      },
    ],
  },
  ConnectionBoardStageMaster: {
    file: "LGAマスター - 人脈ボードステージ.tsv",
    fullName: "Soccer.Shared.ConnectionBoardStageMaster",
    extends: "StoryBoardStageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Type",
        type: "StoryBoardStageType",
        kind: "enum",
        enumValues: [
          {
            name: "Battle",
            value: "0",
          },
          {
            name: "Scenario",
            value: "1",
          },
          {
            name: "Reward",
            value: "2",
          },
          {
            name: "RouteLock",
            value: "3",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RewardType",
        type: "StageRewardType",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Big",
            value: "1",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsMainStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsVisibleWhenLocked",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredStagesToUnlock",
        type: "StoryBoardStageMaster[]",
        kind: "array",
        ref: "StoryBoardStageMaster",
        element: "StoryBoardStageMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredCharacters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedTeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedDirector",
        type: "DirectorItemMasterWithLevel",
        kind: "struct",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedPlayers",
        type: "FixedPlayerMaster[]",
        kind: "array",
        ref: "FixedPlayerMaster",
        element: "FixedPlayerMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "Area",
        type: "ConnectionBoardAreaMaster",
        kind: "ref",
        ref: "ConnectionBoardAreaMaster",
      },
      {
        name: "RequiredMainStoryStagesToUnlock",
        type: "MainStoryStageMaster[]",
        kind: "array",
        ref: "MainStoryStageMaster",
        element: "MainStoryStageMaster",
      },
      {
        name: "RequiredCharactersToUnlock",
        type: "CharacterAndAffinity[]",
        kind: "array",
        element: "CharacterAndAffinity",
      },
    ],
  },
  DirectorGrowthRecipeMasterData: {
    file: "LGAマスター - 監督 - 成長素材.tsv",
    fullName: "Soccer.Shared.DirectorGrowthRecipeMasterData",
    extends: null,
    columns: [
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "RequirementsToNext",
        type: "ItemMasterWithQuantity[]",
        kind: "array",
        element: "ItemMasterWithQuantity",
      },
      {
        name: "Next",
        type: "DirectorGrowthRecipeMasterData",
        kind: "struct",
      },
    ],
  },
  DirectorLevelTotalPowerBonusMaster: {
    file: "LGAマスター - 総合能力監督レベルボーナス.tsv",
    fullName: "Soccer.Shared.DirectorLevelTotalPowerBonusMaster",
    extends: null,
    columns: [
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "TotalPowerBonus",
        type: "decimal",
        kind: "float",
      },
    ],
  },
  EnemyTeamMaster: {
    file: "LGAマスター - 敵チーム.tsv",
    fullName: "Soccer.Shared.EnemyTeamMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Players",
        type: "IList<NonUserPlayerMaster>",
        kind: "list",
        ref: "NonUserPlayerMaster",
        element: "NonUserPlayerMaster",
      },
      {
        name: "Director",
        type: "DirectorItemMaster",
        kind: "ref",
        ref: "DirectorItemMaster",
      },
      {
        name: "DirectorLevel",
        type: "int",
        kind: "int",
      },
      {
        name: "BattleFormat",
        type: "BattleFormat",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "SoccerBattle",
            value: "1",
          },
        ],
      },
      {
        name: "TeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
      },
      {
        name: "TeamEmblem",
        type: "ProfileIconItemMaster",
        kind: "ref",
        ref: "ProfileIconItemMaster",
      },
    ],
    relatedFiles: ["LGAマスター - 敵チーム.tsv", "LGAマスター - 敵チームプレイヤー.tsv"],
  },
  EventConnectionBoardAreaMaster: {
    file: "LGAマスター - イベント人脈ボードエリア.tsv",
    fullName: "Soccer.Shared.EventConnectionBoardAreaMaster",
    extends:
      "StoryBoardAreaMaster<EventConnectionBoardAreaMaster, EventConnectionBoardStageMaster, EventConnectionBoardChapterMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Stages",
        type: "EventConnectionBoardStageMaster[]",
        kind: "array",
        ref: "EventConnectionBoardStageMaster",
        element: "EventConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "MapAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Chapter",
        type: "EventConnectionBoardChapterMaster",
        kind: "ref",
        ref: "EventConnectionBoardChapterMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Prev",
        type: "EventConnectionBoardAreaMaster",
        kind: "ref",
        ref: "EventConnectionBoardAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Next",
        type: "EventConnectionBoardAreaMaster",
        kind: "ref",
        ref: "EventConnectionBoardAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FirstMainStages",
        type: "EventConnectionBoardStageMaster[]",
        kind: "array",
        ref: "EventConnectionBoardStageMaster",
        element: "EventConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FinalMainStages",
        type: "EventConnectionBoardStageMaster[]",
        kind: "array",
        ref: "EventConnectionBoardStageMaster",
        element: "EventConnectionBoardStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "RequiredConnectionBoardStageToUnlock",
        type: "EventConnectionBoardStageMaster",
        kind: "ref",
        ref: "EventConnectionBoardStageMaster",
      },
    ],
  },
  EventConnectionBoardChapterMaster: {
    file: "LGAマスター - イベント人脈ボードチャプター.tsv",
    fullName: "Soccer.Shared.EventConnectionBoardChapterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Areas",
        type: "EventConnectionBoardAreaMaster[]",
        kind: "array",
        ref: "EventConnectionBoardAreaMaster",
        element: "EventConnectionBoardAreaMaster",
      },
      {
        name: "Event",
        type: "EventMaster",
        kind: "ref",
        ref: "EventMaster",
      },
    ],
  },
  EventConnectionBoardStageMaster: {
    file: "LGAマスター - イベント人脈ボードステージ.tsv",
    fullName: "Soccer.Shared.EventConnectionBoardStageMaster",
    extends: "StoryBoardStageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Type",
        type: "StoryBoardStageType",
        kind: "enum",
        enumValues: [
          {
            name: "Battle",
            value: "0",
          },
          {
            name: "Scenario",
            value: "1",
          },
          {
            name: "Reward",
            value: "2",
          },
          {
            name: "RouteLock",
            value: "3",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RewardType",
        type: "StageRewardType",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Big",
            value: "1",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsMainStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsVisibleWhenLocked",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredStagesToUnlock",
        type: "StoryBoardStageMaster[]",
        kind: "array",
        ref: "StoryBoardStageMaster",
        element: "StoryBoardStageMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredCharacters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedTeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedDirector",
        type: "DirectorItemMasterWithLevel",
        kind: "struct",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedPlayers",
        type: "FixedPlayerMaster[]",
        kind: "array",
        ref: "FixedPlayerMaster",
        element: "FixedPlayerMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "Area",
        type: "EventConnectionBoardAreaMaster",
        kind: "ref",
        ref: "EventConnectionBoardAreaMaster",
      },
      {
        name: "RequiredCharactersToUnlock",
        type: "CharacterAndAffinity[]",
        kind: "array",
        element: "CharacterAndAffinity",
      },
    ],
  },
  EventGuideMaster: {
    file: "LGAマスター - イベントガイド.tsv",
    fullName: "Soccer.Shared.EventGuideMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "TitleKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "AssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "SlidePageCount",
        type: "int",
        kind: "int",
      },
      {
        name: "Event",
        type: "EventMaster",
        kind: "ref",
        ref: "EventMaster",
      },
    ],
  },
  EventMaster: {
    file: "LGAマスター - イベント.tsv",
    fullName: "Soccer.Shared.EventMaster",
    extends: "ISchedulableByScheduleMaster<EventScheduleMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "EventStoryChapter",
        type: "EventStoryChapterMaster",
        kind: "ref",
        ref: "EventStoryChapterMaster",
      },
      {
        name: "EventBoardChapter",
        type: "EventConnectionBoardChapterMaster",
        kind: "ref",
        ref: "EventConnectionBoardChapterMaster",
      },
      {
        name: "DailyMissionGroup",
        type: "EventMissionGroupMaster",
        kind: "ref",
        ref: "EventMissionGroupMaster",
      },
      {
        name: "WeeklyMissionGroup",
        type: "EventMissionGroupMaster",
        kind: "ref",
        ref: "EventMissionGroupMaster",
      },
      {
        name: "PermanentMissionGroup",
        type: "EventMissionGroupMaster",
        kind: "ref",
        ref: "EventMissionGroupMaster",
      },
      {
        name: "EventShopCategory",
        type: "ShopCategoryMaster",
        kind: "ref",
        ref: "ShopCategoryMaster",
      },
      {
        name: "Guide",
        type: "EventGuideMaster",
        kind: "ref",
        ref: "EventGuideMaster",
      },
      {
        name: "EventAssetsRootPath",
        type: "string",
        kind: "string",
      },
    ],
  },
  EventMissionGroupMaster: {
    file: "LGAマスター - ミッショングループ - イベント.tsv",
    fullName: "Soccer.Shared.EventMissionGroupMaster",
    extends: "BaseMissionGroupMaster, IObtainablePointRewards",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "PointMaster",
        type: "MissionPointMaster",
        kind: "ref",
        ref: "MissionPointMaster",
      },
      {
        name: "EventMaster",
        type: "EventMaster",
        kind: "ref",
        ref: "EventMaster",
      },
    ],
  },
  EventStoryAreaMaster: {
    file: "LGAマスター - イベントストーリーエリア.tsv",
    fullName: "Soccer.Shared.EventStoryAreaMaster",
    extends:
      "StoryBoardAreaMaster<EventStoryAreaMaster, EventStoryStageMaster, EventStoryChapterMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Stages",
        type: "EventStoryStageMaster[]",
        kind: "array",
        ref: "EventStoryStageMaster",
        element: "EventStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "MapAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Chapter",
        type: "EventStoryChapterMaster",
        kind: "ref",
        ref: "EventStoryChapterMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Prev",
        type: "EventStoryAreaMaster",
        kind: "ref",
        ref: "EventStoryAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Next",
        type: "EventStoryAreaMaster",
        kind: "ref",
        ref: "EventStoryAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FirstMainStages",
        type: "EventStoryStageMaster[]",
        kind: "array",
        ref: "EventStoryStageMaster",
        element: "EventStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FinalMainStages",
        type: "EventStoryStageMaster[]",
        kind: "array",
        ref: "EventStoryStageMaster",
        element: "EventStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "RequiredStoryStageToUnlock",
        type: "EventStoryStageMaster",
        kind: "ref",
        ref: "EventStoryStageMaster",
      },
    ],
  },
  EventStoryChapterMaster: {
    file: "LGAマスター - イベントストーリーチャプター.tsv",
    fullName: "Soccer.Shared.EventStoryChapterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Areas",
        type: "EventStoryAreaMaster[]",
        kind: "array",
        ref: "EventStoryAreaMaster",
        element: "EventStoryAreaMaster",
      },
      {
        name: "Event",
        type: "EventMaster",
        kind: "ref",
        ref: "EventMaster",
      },
    ],
  },
  EventStoryStageMaster: {
    file: "LGAマスター - イベントストーリーステージ.tsv",
    fullName: "Soccer.Shared.EventStoryStageMaster",
    extends: "StoryBoardStageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Type",
        type: "StoryBoardStageType",
        kind: "enum",
        enumValues: [
          {
            name: "Battle",
            value: "0",
          },
          {
            name: "Scenario",
            value: "1",
          },
          {
            name: "Reward",
            value: "2",
          },
          {
            name: "RouteLock",
            value: "3",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RewardType",
        type: "StageRewardType",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Big",
            value: "1",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsMainStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsVisibleWhenLocked",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredStagesToUnlock",
        type: "StoryBoardStageMaster[]",
        kind: "array",
        ref: "StoryBoardStageMaster",
        element: "StoryBoardStageMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredCharacters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedTeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedDirector",
        type: "DirectorItemMasterWithLevel",
        kind: "struct",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedPlayers",
        type: "FixedPlayerMaster[]",
        kind: "array",
        ref: "FixedPlayerMaster",
        element: "FixedPlayerMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "Area",
        type: "EventStoryAreaMaster",
        kind: "ref",
        ref: "EventStoryAreaMaster",
      },
    ],
  },
  ExpTableLevelMaster: {
    file: "LGAマスター - 経験値テーブル.tsv",
    fullName: "Soccer.Shared.ExpTableLevelMaster",
    extends: null,
    columns: [
      {
        name: "RequiredExpToNext",
        type: "int",
        kind: "int",
      },
      {
        name: "RequiredPointToNext",
        type: "int",
        kind: "int",
      },
      {
        name: "RequiredCoinToNext",
        type: "int",
        kind: "int",
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "Next",
        type: "ExpTableLevelMaster",
        kind: "ref",
        ref: "ExpTableLevelMaster",
      },
    ],
  },
  ExtraCupGroupMaster: {
    file: "LGAマスター - エクストラカップグループ.tsv",
    fullName: "Soccer.Shared.ExtraCupGroupMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
      },
      {
        name: "RequiredTags",
        type: "CharacterTagMaster[]",
        kind: "array",
        ref: "CharacterTagMaster",
        element: "CharacterTagMaster",
      },
      {
        name: "Stages",
        type: "ExtraCupStageMaster[]",
        kind: "array",
        ref: "ExtraCupStageMaster",
        element: "ExtraCupStageMaster",
      },
    ],
  },
  ExtraCupStageMaster: {
    file: "LGAマスター - エクストラカップステージ.tsv",
    fullName: "Soccer.Shared.ExtraCupStageMaster",
    extends: "StageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Group",
        type: "ExtraCupGroupMaster",
        kind: "ref",
        ref: "ExtraCupGroupMaster",
      },
      {
        name: "Index",
        type: "int",
        kind: "int",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
      },
      {
        name: "Prev",
        type: "ExtraCupStageMaster",
        kind: "ref",
        ref: "ExtraCupStageMaster",
      },
      {
        name: "Next",
        type: "ExtraCupStageMaster",
        kind: "ref",
        ref: "ExtraCupStageMaster",
      },
    ],
  },
  FieldAreaMaster: {
    file: "LGAマスター - フィールドエリア.tsv",
    fullName: "Soccer.Shared.FieldAreaMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "BattleFormat",
        type: "BattleFormat",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "SoccerBattle",
            value: "1",
          },
        ],
      },
      {
        name: "TopLeftRight",
        type: "int",
        kind: "int",
      },
      {
        name: "TopLeftForward",
        type: "int",
        kind: "int",
      },
      {
        name: "BottomRightRight",
        type: "int",
        kind: "int",
      },
      {
        name: "BottomRightForward",
        type: "int",
        kind: "int",
      },
    ],
  },
  FieldMaster: {
    file: "LGAマスター - フィールド.tsv",
    fullName: "Soccer.Shared.FieldMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Passives",
        type: "PassiveMaster[]",
        kind: "array",
        ref: "PassiveMaster",
        element: "PassiveMaster",
      },
    ],
  },
  FieldTerrainMaster: {
    file: "LGAマスター - フィールド地形.tsv",
    fullName: "Soccer.Shared.FieldTerrainMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxForward",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxRight",
        type: "int",
        kind: "int",
      },
      {
        name: "PenaltyAreaMaxForward",
        type: "int",
        kind: "int",
      },
      {
        name: "PenaltyAreaMaxRight",
        type: "int",
        kind: "int",
      },
    ],
  },
  FixedDropTableMaster: {
    file: "LGAマスター - ドロップテーブル(固定).tsv",
    fullName: "Soccer.Shared.FixedDropTableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Items",
        type: "ItemMasterWithQuantity[]",
        kind: "array",
        element: "ItemMasterWithQuantity",
      },
    ],
  },
  FixedPlayerMaster: {
    file: "LGAマスター - 編成固定プレイヤー.tsv",
    fullName: "Soccer.Shared.FixedPlayerMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Slot",
        type: "int",
        kind: "int",
      },
      {
        name: "EquipmentLevel",
        type: "int",
        kind: "int",
      },
      {
        name: "NonUserPlayer",
        type: "NonUserPlayerMaster",
        kind: "ref",
        ref: "NonUserPlayerMaster",
      },
    ],
  },
  FormationDeckMaster: {
    file: "LGAマスター - フォーメーションデッキ.tsv",
    fullName: "Soccer.Shared.FormationDeckMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Index",
        type: "int",
        kind: "int",
      },
      {
        name: "BattleType",
        type: "BattleType",
        kind: "enum",
        enumValues: [
          {
            name: "MainStory",
            value: "0",
          },
          {
            name: "Pvp",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "ExtraCup",
            value: "3",
          },
          {
            name: "Inalink",
            value: "4",
          },
          {
            name: "ConnectionBoard",
            value: "5",
          },
          {
            name: "Tutorial",
            value: "6",
          },
          {
            name: "EventStory",
            value: "7",
          },
          {
            name: "EventConnectionBoard",
            value: "8",
          },
        ],
      },
      {
        name: "BattleFormat",
        type: "BattleFormat",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "SoccerBattle",
            value: "1",
          },
        ],
      },
      {
        name: "IsFixedFormation",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  GachaBackgroundCutsceneMaster: {
    file: "LGAマスター - ガチャ背景カットシーン.tsv",
    fullName: "Soccer.Shared.GachaBackgroundCutsceneMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "MainCharacterMaster",
        type: "CharacterMaster",
        kind: "ref",
        ref: "CharacterMaster",
      },
      {
        name: "SpecialMoveMaster",
        type: "SpecialMoveMaster",
        kind: "ref",
        ref: "SpecialMoveMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
      },
      {
        name: "AllyCharacterMasters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
      },
      {
        name: "OpponentCharacterMasters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
      },
    ],
  },
  GachaDroptableMaster: {
    file: "LGAマスター - ガチャ抽選テーブル.tsv",
    fullName: "Soccer.Shared.GachaDroptableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "MasterOrderEntries",
        type: "GachaDroptableEntryMaster[]",
        kind: "array",
        ref: "GachaDroptableEntryMaster",
        element: "GachaDroptableEntryMaster",
      },
      {
        name: "WeightOrderedEntries",
        type: "GachaDroptableEntryMaster[]",
        kind: "array",
        ref: "GachaDroptableEntryMaster",
        element: "GachaDroptableEntryMaster",
      },
      {
        name: "WishlistEntries",
        type: "GachaDroptableEntryMaster[]",
        kind: "array",
        ref: "GachaDroptableEntryMaster",
        element: "GachaDroptableEntryMaster",
      },
    ],
  },
  GachaItemPresentationMaster: {
    file: "LGAマスター - ガチャ商品登場演出テーブル.tsv",
    fullName: "Soccer.Shared.GachaItemPresentationMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "TimelineName",
        type: "string",
        kind: "string",
      },
      {
        name: "TargetResult",
        type: "GachaItemPresentationTargetResult",
        kind: "enum",
        enumValues: [
          {
            name: "Item",
            value: "0",
          },
          {
            name: "Grade1",
            value: "1",
          },
          {
            name: "Grade2",
            value: "2",
          },
          {
            name: "Grade3",
            value: "3",
          },
          {
            name: "Upgraded1To2",
            value: "4",
          },
          {
            name: "Upgraded1To3",
            value: "5",
          },
          {
            name: "Upgraded2To3",
            value: "6",
          },
        ],
      },
      {
        name: "MainPresentationBallAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "Weight",
        type: "int",
        kind: "int",
      },
    ],
  },
  GachaMachineMaster: {
    file: "LGAマスター - ガチャ筐体.tsv",
    fullName: "Soccer.Shared.GachaMachineMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "BackgroundImageAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "DetailWebUrl",
        type: "string",
        kind: "string",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
      },
      {
        name: "BaseDiamondPrice",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "IsBaseDiamondPricePaidOnly",
        type: "bool",
        kind: "bool",
      },
      {
        name: "BaseTicket",
        type: "ItemMaster",
        kind: "ref",
        ref: "ItemMaster",
      },
      {
        name: "CanDraw1For1BasePrice",
        type: "bool",
        kind: "bool",
      },
      {
        name: "CanDraw10For10BasePrices",
        type: "bool",
        kind: "bool",
      },
      {
        name: "Draw10PaidDiamondPrice",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "Draw10Ticket",
        type: "ItemMaster",
        kind: "ref",
        ref: "ItemMaster",
      },
      {
        name: "OncePerDayPaidDiamondPrice",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "MaxDrawCount",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "PityCount",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "PityDroptable",
        type: "GachaDroptableMaster",
        kind: "ref",
        ref: "GachaDroptableMaster",
      },
      {
        name: "Droptables",
        type: "GachaDroptableMaster[]",
        kind: "array",
        ref: "GachaDroptableMaster",
        element: "GachaDroptableMaster",
      },
      {
        name: "Presentation",
        type: "GachaPresentationMaster",
        kind: "ref",
        ref: "GachaPresentationMaster",
      },
      {
        name: "BackgroundCutscenes",
        type: "GachaBackgroundCutsceneMaster[]",
        kind: "array",
        ref: "GachaBackgroundCutsceneMaster",
        element: "GachaBackgroundCutsceneMaster",
      },
    ],
  },
  GachaMainPresentationMaster: {
    file: "LGAマスター - ガチャメイン演出テーブル.tsv",
    fullName: "Soccer.Shared.GachaMainPresentationMaster",
    extends: null,
    columns: [
      {
        name: "TimelineName",
        type: "string",
        kind: "string",
      },
      {
        name: "ResultFilter",
        type: "GachaMainPresentationResultFilter",
        kind: "enum",
        enumValues: [
          {
            name: "Everything",
            value: "0",
          },
          {
            name: "ContainsGrade2Or3",
            value: "1",
          },
          {
            name: "ContainsGrade3",
            value: "2",
          },
          {
            name: "ContainsPickup",
            value: "3",
          },
        ],
      },
      {
        name: "Weight",
        type: "int",
        kind: "int",
      },
    ],
  },
  GachaPresentationMaster: {
    file: "LGAマスター - ガチャ演出.tsv",
    fullName: "Soccer.Shared.GachaPresentationMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "MainBackground",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
      },
      {
        name: "MainPresentationTable",
        type: "GachaMainPresentationMaster[]",
        kind: "array",
        ref: "GachaMainPresentationMaster",
        element: "GachaMainPresentationMaster",
      },
      {
        name: "MainPresentationKeeper",
        type: "CharacterMaster",
        kind: "ref",
        ref: "CharacterMaster",
      },
      {
        name: "ItemPresentationTable",
        type: "GachaItemPresentationMaster[]",
        kind: "array",
        ref: "GachaItemPresentationMaster",
        element: "GachaItemPresentationMaster",
      },
      {
        name: "ProductObtainPresentationBackground",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
      },
      {
        name: "NonCharacterObtainPresentationTimelineName",
        type: "string",
        kind: "string",
      },
    ],
  },
  GachaPresentationVariationMaster: {
    file: "LGAマスター - ガチャ演出バリエーショングループ.tsv",
    fullName: "Soccer.Shared.GachaPresentationVariationMaster",
    extends: null,
    columns: [
      {
        name: "GroupCode",
        type: "int",
        kind: "int",
      },
      {
        name: "VariationName",
        type: "string",
        kind: "string",
      },
      {
        name: "IsDefault",
        type: "bool",
        kind: "bool",
      },
      {
        name: "ResultFilter",
        type: "GachaMainPresentationResultFilter",
        kind: "enum",
        enumValues: [
          {
            name: "Everything",
            value: "0",
          },
          {
            name: "ContainsGrade2Or3",
            value: "1",
          },
          {
            name: "ContainsGrade3",
            value: "2",
          },
          {
            name: "ContainsPickup",
            value: "3",
          },
        ],
      },
      {
        name: "Probability",
        type: "float",
        kind: "float",
      },
    ],
  },
  GachaWishlistCandidateMaster: {
    file: "LGAマスター - ウィッシュリスト候補.tsv",
    fullName: "Soccer.Shared.GachaWishlistCandidateMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Candidates",
        type: "CharacterItemMaster[]",
        kind: "array",
        ref: "CharacterItemMaster",
        element: "CharacterItemMaster",
      },
    ],
  },
  GameContentTutorialMaster: {
    file: "LGAマスター - コンテンツ別チュートリアル.tsv",
    fullName: "Soccer.Shared.GameContentTutorialMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Version",
        type: "byte",
        kind: "int",
      },
      {
        name: "TitleKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "AssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "SlidePageCount",
        type: "int",
        kind: "int",
      },
    ],
  },
  GameContentUnlockConditionMaster: {
    file: "LGAマスター - 機能解放.tsv",
    fullName: "Soccer.Shared.GameContentUnlockConditionMaster",
    extends: null,
    columns: [
      {
        name: "ContentType",
        type: "GameContentType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "ClubHall",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "Scout",
            value: "5",
          },
          {
            name: "Raid",
            value: "6",
          },
          {
            name: "Equipment",
            value: "7",
          },
          {
            name: "Affinity",
            value: "8",
          },
          {
            name: "SpecialMoveManual",
            value: "9",
          },
          {
            name: "ConnectionBoard",
            value: "10",
          },
          {
            name: "ClubHouse",
            value: "11",
          },
          {
            name: "Guild",
            value: "12",
          },
          {
            name: "GvE",
            value: "13",
          },
          {
            name: "ExtraCup",
            value: "14",
          },
          {
            name: "PvP",
            value: "15",
          },
          {
            name: "Director",
            value: "16",
          },
          {
            name: "Event",
            value: "17",
          },
          {
            name: "MoveSelect",
            value: "18",
          },
          {
            name: "Story",
            value: "19",
          },
          {
            name: "Shop",
            value: "20",
          },
          {
            name: "PassiveModifier",
            value: "21",
          },
          {
            name: "Store",
            value: "22",
          },
        ],
      },
      {
        name: "NotifyUnlockedAndGuideToContent",
        type: "bool",
        kind: "bool",
      },
      {
        name: "RequiredMainStoryStageToUnlock",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "ContentTutorial",
        type: "GameContentTutorialMaster",
        kind: "ref",
        ref: "GameContentTutorialMaster",
      },
    ],
  },
  GuildEmblemMaster: {
    file: "LGAマスター - ギルド - エンブレム.tsv",
    fullName: "Soccer.Shared.GuildEmblemMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Slot",
        type: "GuildEmblemSlot",
        kind: "enum",
        enumValues: [
          {
            name: "Frame",
            value: "0",
          },
          {
            name: "Symbol",
            value: "1",
          },
        ],
      },
      {
        name: "AssetName",
        type: "string",
        kind: "string",
      },
    ],
  },
  GuildMemberCountFilterMaster: {
    file: "LGAマスター - ギルド - 規模分類.tsv",
    fullName: "Soccer.Shared.GuildMemberCountFilterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "string",
        kind: "string",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "MemberCountLowerLimit",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "MemberCountUpperLimit",
        type: "int",
        kind: "int",
        nullable: true,
      },
    ],
  },
  GuildRankAcquisitionMaster: {
    file: "LGAマスター - ギルド - ランクボーナス.tsv",
    fullName: "Soccer.Shared.GuildRankAcquisitionMaster",
    extends: null,
    columns: [
      {
        name: "RankCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ObtainableGuildTokenQuantityInWeek",
        type: "int",
        kind: "int",
      },
      {
        name: "UnlockedEmblemsUntilThisRank",
        type: "List<GuildEmblemMaster>",
        kind: "list",
        ref: "GuildEmblemMaster",
        element: "GuildEmblemMaster",
      },
    ],
  },
  GuildRankMaster: {
    file: "LGAマスター - ギルド - ランク.tsv",
    fullName: "Soccer.Shared.GuildRankMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "ExpCumulativeLowerLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "Acquisition",
        type: "GuildRankAcquisitionMaster",
        kind: "ref",
        ref: "GuildRankAcquisitionMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Prev",
        type: "GuildRankMaster",
        kind: "ref",
        ref: "GuildRankMaster",
      },
      {
        name: "Next",
        type: "GuildRankMaster",
        kind: "ref",
        ref: "GuildRankMaster",
      },
    ],
  },
  GuildResourceMaster: {
    file: "LGAマスター - ギルド - 共有リソース.tsv",
    fullName: "Soccer.Shared.GuildResourceMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Type",
        type: "GuildResourceType",
        kind: "enum",
        enumValues: [
          {
            name: "Exp",
            value: "0",
          },
          {
            name: "GvEPoint",
            value: "1",
          },
        ],
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "WeeklyIncrementLimit",
        type: "int",
        kind: "int",
      },
    ],
  },
  GuildWeeklyContributionRewardMaster: {
    file: "LGAマスター - ギルド - 週間貢献度報酬.tsv",
    fullName: "Soccer.Shared.GuildWeeklyContributionRewardMaster",
    extends: null,
    columns: [
      {
        name: "ContributionLowerLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "NextUp",
        type: "GuildWeeklyContributionRewardMaster",
        kind: "ref",
        ref: "GuildWeeklyContributionRewardMaster",
      },
      {
        name: "NextDown",
        type: "GuildWeeklyContributionRewardMaster",
        kind: "ref",
        ref: "GuildWeeklyContributionRewardMaster",
      },
    ],
  },
  InalinkGroupMaster: {
    file: "LGAマスター - イナリンクグループ.tsv",
    fullName: "Soccer.Shared.InalinkGroupMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "GroupName",
        type: "string",
        kind: "string",
      },
      {
        name: "Category",
        type: "InalinkCategory",
        kind: "enum",
        enumValues: [
          {
            name: "Personal",
            value: "0",
          },
          {
            name: "Event",
            value: "1",
          },
          {
            name: "Group",
            value: "2",
          },
        ],
      },
      {
        name: "GroupIcon",
        type: "string",
        kind: "string",
      },
      {
        name: "Threads",
        type: "InalinkThreadMaster[]",
        kind: "array",
        ref: "InalinkThreadMaster",
        element: "InalinkThreadMaster",
      },
    ],
    relatedFiles: [
      "LGAマスター - イナリンクグループ.tsv",
      "LGAマスター - イナリンクスレッド.tsv",
      "LGAマスター - イナリンクメッセージ.tsv",
      "LGAマスター - イナリンクキャラクター.tsv",
      "LGAマスター - イナリンクボイス.tsv",
    ],
  },
  InitialFormationMaster: {
    file: "LGAマスター - 初期フォーメーション.tsv",
    fullName: "Soccer.Shared.InitialFormationMaster",
    extends: null,
    columns: [
      {
        name: "Deck",
        type: "FormationDeckMaster",
        kind: "ref",
        ref: "FormationDeckMaster",
      },
      {
        name: "Director",
        type: "DirectorItemMaster",
        kind: "ref",
        ref: "DirectorItemMaster",
      },
      {
        name: "TeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
      },
      {
        name: "Members",
        type: "InitialCharacterMaster[]",
        kind: "array",
        ref: "InitialCharacterMaster",
        element: "InitialCharacterMaster",
      },
    ],
  },
  InstructionNavigationMaster: {
    file: "LGAマスター - 説明ナビゲーション.tsv",
    fullName: "Soccer.Shared.InstructionNavigationMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "MessageKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "ShowIcon",
        type: "bool",
        kind: "bool",
      },
      {
        name: "ForceClickButton",
        type: "bool",
        kind: "bool",
      },
      {
        name: "HighlightingObject",
        type: "InstructionNavigationHighlightTarget",
        kind: "enum",
        enumValues: [
          {
            name: "SoccerBattleAutoPlayButton",
            value: "0",
          },
          {
            name: "SoccerBattleSpeedChangeButton",
            value: "1",
          },
          {
            name: "AreaChangeButton",
            value: "2",
          },
          {
            name: "Area2Button",
            value: "3",
          },
          {
            name: "BackToHomeButton",
            value: "4",
          },
          {
            name: "ScoutButton",
            value: "5",
          },
          {
            name: "TutorialGachaButton",
            value: "6",
          },
          {
            name: "ClubHallButton",
            value: "7",
          },
          {
            name: "TrainingStageButton",
            value: "8",
          },
          {
            name: "StartTrainingStageButton",
            value: "9",
          },
          {
            name: "OmakaseFormationButton",
            value: "10",
          },
          {
            name: "OmakaseDecideButton",
            value: "11",
          },
          {
            name: "StartSoccerBattleButton",
            value: "12",
          },
          {
            name: "EntrustButton",
            value: "13",
          },
          {
            name: "EntrustDecideButton",
            value: "14",
          },
          {
            name: "ObtainTrainingRewardButton",
            value: "15",
          },
        ],
        nullable: true,
      },
    ],
  },
  InvitationRewardMaster: {
    file: "LGAマスター - 招待報酬.tsv",
    fullName: "Soccer.Shared.InvitationRewardMaster",
    extends: null,
    columns: [
      {
        name: "UserType",
        type: "InvitationUserType",
        kind: "enum",
        enumValues: [
          {
            name: "Inviter",
            value: "0",
          },
          {
            name: "Invitee",
            value: "1",
          },
        ],
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
    ],
  },
  AffinityItemMaster: {
    file: "LGAマスター - アイテム - プレゼント.tsv",
    fullName: "Soccer.Shared.AffinityItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "BasePoint",
        type: "int",
        kind: "int",
      },
      {
        name: "SpecialTag",
        type: "CharacterTagMaster",
        kind: "ref",
        ref: "CharacterTagMaster",
      },
      {
        name: "BonusPoint",
        type: "int",
        kind: "int",
      },
    ],
  },
  CharacterItemMaster: {
    file: "LGAマスター - アイテム - キャラクター.tsv",
    fullName: "Soccer.Shared.CharacterItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "CharacterMaster",
        type: "CharacterMaster",
        kind: "ref",
        ref: "CharacterMaster",
      },
    ],
  },
  CharacterSoulItemMaster: {
    file: "LGAマスター - アイテム - 覚醒素材.tsv",
    fullName: "Soccer.Shared.CharacterSoulItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "CharacterMaster",
        type: "CharacterMaster",
        kind: "ref",
        ref: "CharacterMaster",
      },
    ],
  },
  CharacterizeItemMaster: {
    file: "LGAマスター - アイテム - キャラクター結晶.tsv",
    fullName: "Soccer.Shared.CharacterizeItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "RequireQuantityForDrawOne",
        type: "int",
        kind: "int",
      },
      {
        name: "LotteryDropTable",
        type: "LotteryDropTableMaster",
        kind: "ref",
        ref: "LotteryDropTableMaster",
      },
    ],
  },
  ClubHouseDecorationItemMaster: {
    file: "LGAマスター - アイテム - 部室配置品.tsv",
    fullName: "Soccer.Shared.ClubHouseDecorationItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "SlotType",
        type: "ClubHouseDecorationSlotType",
        kind: "enum",
        enumValues: [
          {
            name: "StuffedToy",
            value: "0",
          },
          {
            name: "Trophy",
            value: "1",
          },
          {
            name: "WallArt",
            value: "2",
          },
          {
            name: "Carpet",
            value: "3",
          },
        ],
      },
      {
        name: "AssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "Width",
        type: "int",
        kind: "int",
      },
    ],
  },
  DiamondItemMaster: {
    file: "LGAマスター - アイテム - ダイヤ.tsv",
    fullName: "Soccer.Shared.DiamondItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IsPaid",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  DirectorItemMaster: {
    file: "LGAマスター - アイテム - 監督.tsv",
    fullName: "Soccer.Shared.DirectorItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconBustShotAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "Formation",
        type: "FormationMaster",
        kind: "ref",
        ref: "FormationMaster",
      },
      {
        name: "BaseTotalPower",
        type: "int",
        kind: "int",
      },
      {
        name: "Growths",
        type: "DirectorGrowthMaster[]",
        kind: "array",
        ref: "DirectorGrowthMaster",
        element: "DirectorGrowthMaster",
      },
      {
        name: "PassiveCodeToGrowths",
        type: "Dictionary<Int32, DirectorGrowthMaster[]>",
        kind: "dict",
        key: "int",
        value: "DirectorGrowthMaster[]",
      },
      {
        name: "DirectorMaxLevel",
        type: "int",
        kind: "int",
      },
      {
        name: "IsEnemyOnly",
        type: "bool",
        kind: "bool",
      },
    ],
    relatedFiles: ["LGAマスター - アイテム - 監督.tsv", "LGAマスター - 監督 - 成長.tsv"],
  },
  DirectorLevelUpMaterialItemMaster: {
    file: "LGAマスター - アイテム - 監督強化素材.tsv",
    fullName: "Soccer.Shared.DirectorLevelUpMaterialItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
    ],
  },
  ElementAwakenItemMaster: {
    file: "LGAマスター - アイテム - 属性おにぎり.tsv",
    fullName: "Soccer.Shared.ElementAwakenItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Element",
        type: "CharacterElement",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Wind",
            value: "1",
          },
          {
            name: "Forest",
            value: "2",
          },
          {
            name: "Fire",
            value: "3",
          },
          {
            name: "Mountain",
            value: "4",
          },
        ],
        nullable: true,
      },
    ],
  },
  EquipmentCraftingMaterialItemMaster: {
    file: "LGAマスター - アイテム - 装備制作素材.tsv",
    fullName: "Soccer.Shared.EquipmentCraftingMaterialItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "UpperGradeMaterial",
        type: "EquipmentCraftingMaterialItemMaster",
        kind: "ref",
        ref: "EquipmentCraftingMaterialItemMaster",
      },
      {
        name: "ConsumeQuantityForGradeUp",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "LowerGradeMaterial",
        type: "EquipmentCraftingMaterialItemMaster",
        kind: "ref",
        ref: "EquipmentCraftingMaterialItemMaster",
      },
      {
        name: "CraftableEquipmentMinLevel",
        type: "int",
        kind: "int",
      },
      {
        name: "CraftableEquipmentMaxLevel",
        type: "int",
        kind: "int",
      },
    ],
  },
  EquipmentItemMaster: {
    file: "LGAマスター - アイテム - 装備.tsv",
    fullName: "Soccer.Shared.EquipmentItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Position",
        type: "CharacterPosition",
        kind: "enum",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
      },
      {
        name: "Slot",
        type: "EquipmentSlot",
        kind: "enum",
        enumValues: [
          {
            name: "Shoes",
            value: "0",
          },
          {
            name: "Misanga",
            value: "1",
          },
          {
            name: "ShinGuards",
            value: "2",
          },
          {
            name: "Wristband",
            value: "3",
          },
          {
            name: "Gloves",
            value: "4",
          },
          {
            name: "Pendant",
            value: "5",
          },
        ],
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "Kick",
        type: "int",
        kind: "int",
      },
      {
        name: "Technique",
        type: "int",
        kind: "int",
      },
      {
        name: "Block",
        type: "int",
        kind: "int",
      },
      {
        name: "Catch",
        type: "int",
        kind: "int",
      },
      {
        name: "Speed",
        type: "int",
        kind: "int",
      },
      {
        name: "DismantlingMaster",
        type: "EquipmentDismantlingMaster",
        kind: "ref",
        ref: "EquipmentDismantlingMaster",
      },
      {
        name: "CraftingMaster",
        type: "EquipmentCraftingMaster",
        kind: "ref",
        ref: "EquipmentCraftingMaster",
      },
    ],
    relatedFiles: [
      "LGAマスター - アイテム - 装備.tsv",
      "LGAマスター - 装備分解.tsv",
      "LGAマスター - 装備制作.tsv",
    ],
  },
  FocusedTrainingTicketItemMaster: {
    file: "LGAマスター - アイテム - 集中部活券.tsv",
    fullName: "Soccer.Shared.FocusedTrainingTicketItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "TrainingReward",
        type: "VirtualCurrencyItemMaster",
        kind: "ref",
        ref: "VirtualCurrencyItemMaster",
      },
      {
        name: "TrainingDurationMinutes",
        type: "int",
        kind: "int",
      },
    ],
  },
  FormationMaster: {
    file: "LGAマスター - フォーメーション.tsv",
    fullName: "Soccer.Shared.FormationMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Slots",
        type: "FormationSlotMaster[]",
        kind: "array",
        ref: "FormationSlotMaster",
        element: "FormationSlotMaster",
      },
      {
        name: "FormationEffectPassive",
        type: "PassiveMaster",
        kind: "ref",
        ref: "PassiveMaster",
      },
    ],
    relatedFiles: [
      "LGAマスター - フォーメーション.tsv",
      "LGAマスター - フォーメーションスロット.tsv",
    ],
  },
  GachaTicketItemMaster: {
    file: "LGAマスター - アイテム - ガチャチケット.tsv",
    fullName: "Soccer.Shared.GachaTicketItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
    ],
  },
  HonoraryTitleItemMaster: {
    file: "LGAマスター - アイテム - 称号.tsv",
    fullName: "Soccer.Shared.HonoraryTitleItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Category",
        type: "HonoraryTitleCategory",
        kind: "enum",
        enumValues: [
          {
            name: "Affinity",
            value: "0",
          },
          {
            name: "Awakening",
            value: "1",
          },
          {
            name: "PvP",
            value: "2",
          },
          {
            name: "Story",
            value: "3",
          },
          {
            name: "Event",
            value: "4",
          },
          {
            name: "Normal",
            value: "5",
          },
        ],
      },
      {
        name: "TextType",
        type: "HonoraryTitleTextType",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Rainbow",
            value: "1",
          },
          {
            name: "Gold",
            value: "2",
          },
          {
            name: "Silver",
            value: "3",
          },
          {
            name: "Bronze",
            value: "4",
          },
        ],
      },
      {
        name: "BackgroundAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "LabelKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
    ],
  },
  ItemAcquisitionMaster: {
    file: "LGAマスター - アイテム - 入手先.tsv",
    fullName: "Soccer.Shared.ItemAcquisitionMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Content1",
        type: "GameContentType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "ClubHall",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "Scout",
            value: "5",
          },
          {
            name: "Raid",
            value: "6",
          },
          {
            name: "Equipment",
            value: "7",
          },
          {
            name: "Affinity",
            value: "8",
          },
          {
            name: "SpecialMoveManual",
            value: "9",
          },
          {
            name: "ConnectionBoard",
            value: "10",
          },
          {
            name: "ClubHouse",
            value: "11",
          },
          {
            name: "Guild",
            value: "12",
          },
          {
            name: "GvE",
            value: "13",
          },
          {
            name: "ExtraCup",
            value: "14",
          },
          {
            name: "PvP",
            value: "15",
          },
          {
            name: "Director",
            value: "16",
          },
          {
            name: "Event",
            value: "17",
          },
          {
            name: "MoveSelect",
            value: "18",
          },
          {
            name: "Story",
            value: "19",
          },
          {
            name: "Shop",
            value: "20",
          },
          {
            name: "PassiveModifier",
            value: "21",
          },
          {
            name: "Store",
            value: "22",
          },
        ],
      },
      {
        name: "Content2",
        type: "GameContentType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "ClubHall",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "Scout",
            value: "5",
          },
          {
            name: "Raid",
            value: "6",
          },
          {
            name: "Equipment",
            value: "7",
          },
          {
            name: "Affinity",
            value: "8",
          },
          {
            name: "SpecialMoveManual",
            value: "9",
          },
          {
            name: "ConnectionBoard",
            value: "10",
          },
          {
            name: "ClubHouse",
            value: "11",
          },
          {
            name: "Guild",
            value: "12",
          },
          {
            name: "GvE",
            value: "13",
          },
          {
            name: "ExtraCup",
            value: "14",
          },
          {
            name: "PvP",
            value: "15",
          },
          {
            name: "Director",
            value: "16",
          },
          {
            name: "Event",
            value: "17",
          },
          {
            name: "MoveSelect",
            value: "18",
          },
          {
            name: "Story",
            value: "19",
          },
          {
            name: "Shop",
            value: "20",
          },
          {
            name: "PassiveModifier",
            value: "21",
          },
          {
            name: "Store",
            value: "22",
          },
        ],
        nullable: true,
      },
      {
        name: "Content3",
        type: "GameContentType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "ClubHall",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "Scout",
            value: "5",
          },
          {
            name: "Raid",
            value: "6",
          },
          {
            name: "Equipment",
            value: "7",
          },
          {
            name: "Affinity",
            value: "8",
          },
          {
            name: "SpecialMoveManual",
            value: "9",
          },
          {
            name: "ConnectionBoard",
            value: "10",
          },
          {
            name: "ClubHouse",
            value: "11",
          },
          {
            name: "Guild",
            value: "12",
          },
          {
            name: "GvE",
            value: "13",
          },
          {
            name: "ExtraCup",
            value: "14",
          },
          {
            name: "PvP",
            value: "15",
          },
          {
            name: "Director",
            value: "16",
          },
          {
            name: "Event",
            value: "17",
          },
          {
            name: "MoveSelect",
            value: "18",
          },
          {
            name: "Story",
            value: "19",
          },
          {
            name: "Shop",
            value: "20",
          },
          {
            name: "PassiveModifier",
            value: "21",
          },
          {
            name: "Store",
            value: "22",
          },
        ],
        nullable: true,
      },
    ],
  },
  ModifierPassiveItemMaster: {
    file: "LGAマスター - アイテム - 鍛錬素材.tsv",
    fullName: "Soccer.Shared.ModifierPassiveItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "ModifierPassiveItemType",
        type: "ModifierPassiveItemType",
        kind: "enum",
        enumValues: [
          {
            name: "Piece",
            value: "0",
          },
          {
            name: "Lock",
            value: "1",
          },
        ],
      },
      {
        name: "GrantQuantityWhenDuplicateClubMember",
        type: "int",
        kind: "int",
      },
      {
        name: "ConsumeQuantity",
        type: "int",
        kind: "int",
      },
    ],
  },
  ProfileIconItemMaster: {
    file: "LGAマスター - アイテム - プロフィールアイコン.tsv",
    fullName: "Soccer.Shared.ProfileIconItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
    ],
  },
  RandomEquipmentBoxMaster: {
    file: "LGAマスター - アイテム - ランダム装備ボックス.tsv",
    fullName: "Soccer.Shared.RandomEquipmentBoxMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "Position",
        type: "CharacterPosition",
        kind: "enum",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
        nullable: true,
      },
      {
        name: "Slot",
        type: "EquipmentSlot",
        kind: "enum",
        enumValues: [
          {
            name: "Shoes",
            value: "0",
          },
          {
            name: "Misanga",
            value: "1",
          },
          {
            name: "ShinGuards",
            value: "2",
          },
          {
            name: "Wristband",
            value: "3",
          },
          {
            name: "Gloves",
            value: "4",
          },
          {
            name: "Pendant",
            value: "5",
          },
        ],
        nullable: true,
      },
    ],
  },
  SpecialMoveLevelUpMaterialItemMaster: {
    file: "LGAマスター - アイテム - 必殺技強化素材.tsv",
    fullName: "Soccer.Shared.SpecialMoveLevelUpMaterialItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
    ],
  },
  SpecialMoveManualMaster: {
    file: "LGAマスター - アイテム - 秘伝書.tsv",
    fullName: "Soccer.Shared.SpecialMoveManualMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "SpecialMoveMaster",
        type: "SpecialMoveMaster",
        kind: "ref",
        ref: "SpecialMoveMaster",
      },
    ],
  },
  TeamUniformItemMaster: {
    file: "LGAマスター - アイテム - チームユニフォーム.tsv",
    fullName: "Soccer.Shared.TeamUniformItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "FPModelSet",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
      {
        name: "GKModelSet",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
    ],
  },
  TokenItemMaster: {
    file: "LGAマスター - アイテム - トークン.tsv",
    fullName: "Soccer.Shared.TokenItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
    ],
  },
  VirtualCurrencyItemMaster: {
    file: "LGAマスター - アイテム - 通貨.tsv",
    fullName: "Soccer.Shared.VirtualCurrencyItemMaster",
    extends: "ItemMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "IconAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "Grade",
        type: "int",
        kind: "int",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "ItemMaster",
      },
      {
        name: "VirtualCurrency",
        type: "VirtualCurrency",
        kind: "enum",
        enumValues: [
          {
            name: "Point",
            value: "0",
          },
          {
            name: "Coin",
            value: "1",
          },
          {
            name: "Exp",
            value: "2",
          },
        ],
      },
    ],
  },
  L5iDPointStatusRewardMaster: {
    file: "LGAマスター - L5iD - ステータス特典.tsv",
    fullName: "Soccer.Shared.L5iDPointStatusRewardMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "Prev",
        type: "L5iDPointStatusRewardMaster",
        kind: "ref",
        ref: "L5iDPointStatusRewardMaster",
      },
      {
        name: "Next",
        type: "L5iDPointStatusRewardMaster",
        kind: "ref",
        ref: "L5iDPointStatusRewardMaster",
      },
    ],
  },
  LoginBonusMaster: {
    file: "LGAマスター - ログインボーナス.tsv",
    fullName: "Soccer.Shared.LoginBonusMaster",
    extends: "ISchedulableByScheduleMaster<ScheduleMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "LongNameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "ShortNameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "CanReset",
        type: "bool",
        kind: "bool",
      },
      {
        name: "BackgroundAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "VoiceCueSheetName",
        type: "string",
        kind: "string",
      },
      {
        name: "VoiceCueName",
        type: "string",
        kind: "string",
      },
      {
        name: "BodyTemplateName",
        type: "string",
        kind: "string",
      },
      {
        name: "Rewards",
        type: "LoginBonusRewardMaster[]",
        kind: "array",
        ref: "LoginBonusRewardMaster",
        element: "LoginBonusRewardMaster",
      },
      {
        name: "HasSchedule",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  LoginBonusRewardMaster: {
    file: "LGAマスター - ログインボーナス報酬.tsv",
    fullName: "Soccer.Shared.LoginBonusRewardMaster",
    extends: null,
    columns: [
      {
        name: "DayCount",
        type: "int",
        kind: "int",
      },
      {
        name: "IsFeatured",
        type: "bool",
        kind: "bool",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "Next",
        type: "LoginBonusRewardMaster",
        kind: "ref",
        ref: "LoginBonusRewardMaster",
      },
      {
        name: "Prev",
        type: "LoginBonusRewardMaster",
        kind: "ref",
        ref: "LoginBonusRewardMaster",
      },
    ],
  },
  LotteryDropTableMaster: {
    file: "LGAマスター - ドロップテーブル(抽選).tsv",
    fullName: "Soccer.Shared.LotteryDropTableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Items",
        type: "ItemMasterWithQuantityAndWeight[]",
        kind: "array",
        element: "ItemMasterWithQuantityAndWeight",
      },
    ],
  },
  MVPTitleMaster: {
    file: "LGAマスター - MVP称号.tsv",
    fullName: "Soccer.Shared.MVPTitleMaster",
    extends: null,
    columns: [
      {
        name: "Position",
        type: "CharacterPosition",
        kind: "enum",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
        nullable: true,
      },
      {
        name: "ForCritical",
        type: "bool",
        kind: "bool",
      },
      {
        name: "MaxContributionPoint",
        type: "int",
        kind: "int",
      },
      {
        name: "Title",
        type: "string",
        kind: "string",
      },
    ],
  },
  MainStoryAreaMaster: {
    file: "LGAマスター - メインストーリーエリア.tsv",
    fullName: "Soccer.Shared.MainStoryAreaMaster",
    extends:
      "StoryBoardAreaMaster<MainStoryAreaMaster, MainStoryStageMaster, MainStoryChapterMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Stages",
        type: "MainStoryStageMaster[]",
        kind: "array",
        ref: "MainStoryStageMaster",
        element: "MainStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "MapAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Chapter",
        type: "MainStoryChapterMaster",
        kind: "ref",
        ref: "MainStoryChapterMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Prev",
        type: "MainStoryAreaMaster",
        kind: "ref",
        ref: "MainStoryAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "Next",
        type: "MainStoryAreaMaster",
        kind: "ref",
        ref: "MainStoryAreaMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FirstMainStages",
        type: "MainStoryStageMaster[]",
        kind: "array",
        ref: "MainStoryStageMaster",
        element: "MainStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
      {
        name: "FinalMainStages",
        type: "MainStoryStageMaster[]",
        kind: "array",
        ref: "MainStoryStageMaster",
        element: "MainStoryStageMaster",
        inherited: true,
        from: "StoryBoardAreaMaster",
      },
    ],
  },
  MainStoryChapterMaster: {
    file: "LGAマスター - メインストーリーチャプター.tsv",
    fullName: "Soccer.Shared.MainStoryChapterMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Areas",
        type: "MainStoryAreaMaster[]",
        kind: "array",
        ref: "MainStoryAreaMaster",
        element: "MainStoryAreaMaster",
      },
    ],
  },
  MainStoryStageMaster: {
    file: "LGAマスター - メインストーリーステージ.tsv",
    fullName: "Soccer.Shared.MainStoryStageMaster",
    extends: "StoryBoardStageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Type",
        type: "StoryBoardStageType",
        kind: "enum",
        enumValues: [
          {
            name: "Battle",
            value: "0",
          },
          {
            name: "Scenario",
            value: "1",
          },
          {
            name: "Reward",
            value: "2",
          },
          {
            name: "RouteLock",
            value: "3",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RewardType",
        type: "StageRewardType",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Big",
            value: "1",
          },
        ],
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsMainStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "IsVisibleWhenLocked",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredStagesToUnlock",
        type: "StoryBoardStageMaster[]",
        kind: "array",
        ref: "StoryBoardStageMaster",
        element: "StoryBoardStageMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "RequiredCharacters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedTeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedDirector",
        type: "DirectorItemMasterWithLevel",
        kind: "struct",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "FixedPlayers",
        type: "FixedPlayerMaster[]",
        kind: "array",
        ref: "FixedPlayerMaster",
        element: "FixedPlayerMaster",
        inherited: true,
        from: "StoryBoardStageMaster",
      },
      {
        name: "Area",
        type: "MainStoryAreaMaster",
        kind: "ref",
        ref: "MainStoryAreaMaster",
      },
      {
        name: "RequiredTrainingStageToUnlock",
        type: "TrainingStageMaster",
        kind: "ref",
        ref: "TrainingStageMaster",
      },
    ],
  },
  ManagerCommentMaster: {
    file: "LGAマスター - マネージャーコメント.tsv",
    fullName: "Soccer.Shared.ManagerCommentMaster",
    extends: null,
    columns: [
      {
        name: "Position",
        type: "CharacterPosition",
        kind: "enum",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
      },
      {
        name: "MinContributionPoint",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxContributionPoint",
        type: "int",
        kind: "int",
      },
      {
        name: "Comment",
        type: "string",
        kind: "string",
      },
    ],
  },
  BattlePassMissionGroupMaster: {
    file: "LGAマスター - ミッショングループ - バトルパス.tsv",
    fullName: "Soccer.Shared.BattlePassMissionGroupMaster",
    extends: "BaseMissionGroupMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "BattlePass",
        type: "BattlePassMaster",
        kind: "ref",
        ref: "BattlePassMaster",
      },
    ],
  },
  BattlePassMissionMaster: {
    file: "LGAマスター - ミッション - バトルパス.tsv",
    fullName: "Soccer.Shared.BattlePassMissionMaster",
    extends: "BaseMissionMaster, IObtainableMissionPoint",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "BattlePassPoints",
        type: "int",
        kind: "int",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
    ],
  },
  BeginnerMissionGroupMaster: {
    file: "LGAマスター - ミッショングループ - 初心者.tsv",
    fullName: "Soccer.Shared.BeginnerMissionGroupMaster",
    extends: "BaseMissionGroupMaster, IObtainablePointRewards",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "PointMaster",
        type: "MissionPointMaster",
        kind: "ref",
        ref: "MissionPointMaster",
      },
    ],
  },
  BeginnerMissionMaster: {
    file: "LGAマスター - ミッション - 初心者.tsv",
    fullName: "Soccer.Shared.BeginnerMissionMaster",
    extends: "BaseMissionMaster, IObtainableMissionPoint",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
      {
        name: "Points",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "ActiveStartDays",
        type: "int",
        kind: "int",
      },
    ],
  },
  EventMissionMaster: {
    file: "LGAマスター - ミッション - イベント.tsv",
    fullName: "Soccer.Shared.EventMissionMaster",
    extends: "BaseMissionMaster, IObtainableMissionPoint",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
      {
        name: "Points",
        type: "int",
        kind: "int",
        nullable: true,
      },
    ],
  },
  GuildMissionGroupMaster: {
    file: "LGAマスター - ミッショングループ - ギルド.tsv",
    fullName: "Soccer.Shared.GuildMissionGroupMaster",
    extends: "BaseMissionGroupMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
    ],
  },
  GuildMissionMaster: {
    file: "LGAマスター - ミッション - ギルド.tsv",
    fullName: "Soccer.Shared.GuildMissionMaster",
    extends: "BaseMissionMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
      {
        name: "GuildResourceQuantity",
        type: "int",
        kind: "int",
      },
    ],
  },
  MissionGroupMaster: {
    file: "LGAマスター - ミッショングループ.tsv",
    fullName: "Soccer.Shared.MissionGroupMaster",
    extends: "BaseMissionGroupMaster, IObtainablePointRewards",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "PointMaster",
        type: "MissionPointMaster",
        kind: "ref",
        ref: "MissionPointMaster",
      },
    ],
  },
  MissionMaster: {
    file: "LGAマスター - ミッション.tsv",
    fullName: "Soccer.Shared.MissionMaster",
    extends: "BaseMissionMaster, IObtainableMissionPoint",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
      {
        name: "Points",
        type: "int",
        kind: "int",
        nullable: true,
      },
    ],
  },
  MissionPointMaster: {
    file: "LGAマスター - ミッションポイント.tsv",
    fullName: "Soccer.Shared.MissionPointMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "TargetGroups",
        type: "BaseMissionGroupMaster[]",
        kind: "array",
        ref: "BaseMissionGroupMaster",
        element: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
      },
      {
        name: "Rewards",
        type: "MissionPointRewardMaster[]",
        kind: "array",
        ref: "MissionPointRewardMaster",
        element: "MissionPointRewardMaster",
      },
    ],
  },
  MissionPointRewardMaster: {
    file: "LGAマスター - ミッションポイント - 進捗報酬.tsv",
    fullName: "Soccer.Shared.MissionPointRewardMaster",
    extends: null,
    columns: [
      {
        name: "RequiredPoint",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
    ],
  },
  OfferMissionGroupMaster: {
    file: "LGAマスター - ミッショングループ - オファー.tsv",
    fullName: "Soccer.Shared.OfferMissionGroupMaster",
    extends: "BaseMissionGroupMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "RenewIntervalType",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "EnableManualDependency",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
      {
        name: "MissionConditionKeys",
        type: "IReadOnlyCollection<MissionConditionKey>",
        kind: "list",
        element: "MissionConditionKey",
        inherited: true,
        from: "BaseMissionGroupMaster",
      },
    ],
  },
  OfferMissionMaster: {
    file: "LGAマスター - ミッション - オファー.tsv",
    fullName: "Soccer.Shared.OfferMissionMaster",
    extends: "BaseMissionMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionType",
        type: "MissionConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "SpecifiedStoryClearCount",
            value: "0",
          },
          {
            name: "SpecifiedTrainingStageClearCount",
            value: "1",
          },
          {
            name: "SpecifiedExtraCupClearCount",
            value: "2",
          },
          {
            name: "SpecifiedRaidClearCount",
            value: "3",
          },
          {
            name: "SpecifiedRaidGroupScore",
            value: "4",
          },
          {
            name: "ClubMemberCount",
            value: "5",
          },
          {
            name: "SpecifiedTagClubMemberCount",
            value: "6",
          },
          {
            name: "SpecifiedAwakeningClubMemberCount",
            value: "7",
          },
          {
            name: "SpecifiedClubMemberAwakeningCount",
            value: "8",
          },
          {
            name: "ClubMemberSyncLevel",
            value: "9",
          },
          {
            name: "EquipmentAverageLevel",
            value: "10",
          },
          {
            name: "SpecifiedPositionEquipmentAverageLevel",
            value: "11",
          },
          {
            name: "PvPRank",
            value: "12",
          },
          {
            name: "PvPStartCount",
            value: "13",
          },
          {
            name: "RaidStartCount",
            value: "14",
          },
          {
            name: "ShopGoodsPurchaseCount",
            value: "15",
          },
          {
            name: "GachaDrawCount",
            value: "16",
          },
          {
            name: "LoginCount",
            value: "17",
          },
          {
            name: "TrainingRewardsObtainCount",
            value: "18",
          },
          {
            name: "ProfileAnnouncementUpdateCount",
            value: "19",
          },
          {
            name: "ProfileHonoraryTitleUpdateCount",
            value: "20",
          },
          {
            name: "AccountLinkCount",
            value: "21",
          },
          {
            name: "GuildRelateCount",
            value: "22",
          },
          {
            name: "SpecifiedClubMemberBattleStartCount",
            value: "23",
          },
          {
            name: "SpecifiedClubMemberAffinityRank",
            value: "24",
          },
          {
            name: "DirectorCount",
            value: "25",
          },
          {
            name: "GvEStartCount",
            value: "26",
          },
          {
            name: "SpecifiedItemObtainCount",
            value: "28",
          },
          {
            name: "InstantTrainingCount",
            value: "29",
          },
          {
            name: "ClubPower",
            value: "30",
          },
          {
            name: "ManualSpecialMoveLearnCount",
            value: "31",
          },
          {
            name: "SpecifiedSpecialMoveLevelReachCount",
            value: "32",
          },
          {
            name: "BattleStartCount",
            value: "33",
          },
          {
            name: "SpecifiedConnectionBoardStageClearCount",
            value: "34",
          },
          {
            name: "SpecifiedMissionGroupMissionCompleteCount",
            value: "35",
          },
          {
            name: "SpecifiedDayLoginCount",
            value: "36",
          },
          {
            name: "SpecifiedDayOfWeekLoginCount",
            value: "37",
          },
          {
            name: "SpecifiedEventStoryStageClearCount",
            value: "38",
          },
          {
            name: "SpecifiedEventConnectionBoardStageClearCount",
            value: "39",
          },
          {
            name: "SpecifiedRaidRankInCount",
            value: "9000",
          },
          {
            name: "SpecifiedPvPRankInCount",
            value: "9001",
          },
        ],
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionParameter",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "ConditionThresholdValue",
        type: "int",
        kind: "int",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Dependency",
        type: "BaseMissionMaster",
        kind: "ref",
        ref: "BaseMissionMaster",
        inherited: true,
        from: "BaseMissionMaster",
      },
      {
        name: "Group",
        type: "BaseMissionGroupMaster",
        kind: "ref",
        ref: "BaseMissionGroupMaster",
      },
      {
        name: "Condition",
        type: "MissionCondition",
        kind: "struct",
      },
      {
        name: "OfferMaster",
        type: "OfferMaster",
        kind: "ref",
        ref: "OfferMaster",
      },
    ],
  },
  ModifierPassiveLotteryTableMaster: {
    file: "LGAマスター - 鍛錬抽選テーブル.tsv",
    fullName: "Soccer.Shared.ModifierPassiveLotteryTableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Passives",
        type: "ModifierPassiveWithWeight[]",
        kind: "array",
        element: "ModifierPassiveWithWeight",
      },
    ],
  },
  OfferMaster: {
    file: "LGAマスター - ストア - オファー.tsv",
    fullName: "Soccer.Shared.OfferMaster",
    extends: null,
    columns: [
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "BannerAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "Duration",
        type: "TimeSpan",
        kind: "struct",
      },
      {
        name: "Steps",
        type: "List<OfferStepMaster>",
        kind: "list",
        ref: "OfferStepMaster",
        element: "OfferStepMaster",
      },
      {
        name: "Order",
        type: "int",
        kind: "int",
      },
    ],
  },
  OfferStepMaster: {
    file: "LGAマスター - ストア - オファーステップ.tsv",
    fullName: "Soccer.Shared.OfferStepMaster",
    extends: null,
    columns: [
      {
        name: "Offer",
        type: "OfferMaster",
        kind: "ref",
        ref: "OfferMaster",
      },
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Index",
        type: "int",
        kind: "int",
      },
    ],
  },
  OperationListMaster: {
    file: "LGAマスター - AI命令リスト.tsv",
    fullName: "Soccer.Shared.OperationListMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Script",
        type: "string",
        kind: "string",
      },
      {
        name: "CompileCache",
        type: "object",
        kind: "struct",
      },
    ],
  },
  OperationProfileMaster: {
    file: "LGAマスター - AI命令セット.tsv",
    fullName: "Soccer.Shared.OperationProfileMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "ChoosePassTargetCodeInPassPhaseCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ChoosePassTargetCodeAfterFoulCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ChoosePassTargetCodeInShootPhaseCode",
        type: "int",
        kind: "int",
      },
      {
        name: "KickOffPhaseMoveCode",
        type: "int",
        kind: "int",
      },
      {
        name: "PassPhaseMoveCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DribblePhaseMoveCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ShootPhaseMoveCode",
        type: "int",
        kind: "int",
      },
      {
        name: "AttackPhaseChooseActionCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ShootPhaseMoveSelectionCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DribblePhaseMoveSelectionCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DribbleBlockMoveSelectionCode",
        type: "int",
        kind: "int",
      },
      {
        name: "ShootBlockPhaseMoveSelectionCode",
        type: "int",
        kind: "int",
      },
      {
        name: "KeeperBlockPhaseMoveSelectionCode",
        type: "int",
        kind: "int",
      },
    ],
  },
  ParameterMaster: {
    file: "LGAマスター - パラメータ.tsv",
    fullName: "Soccer.Shared.ParameterMaster",
    extends: null,
    columns: [
      {
        name: "ReviewRequestMainStoryStage",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "ReviewRequestPvPRank",
        type: "int",
        kind: "int",
      },
      {
        name: "RewardReceiveDurationDays",
        type: "int",
        kind: "int",
      },
      {
        name: "PurchaseLevelCost",
        type: "DiamondPayment",
        kind: "struct",
      },
      {
        name: "PurchasePremiumCost",
        type: "DiamondPayment",
        kind: "struct",
      },
      {
        name: "RequiredPointToNext",
        type: "int",
        kind: "int",
      },
      {
        name: "WorldChannelCountPerWorld",
        type: "int",
        kind: "int",
      },
      {
        name: "WorldChannelMemberLimitOnConnect",
        type: "int",
        kind: "int",
      },
      {
        name: "WorldChannelMemberLimitOnReconnect",
        type: "int",
        kind: "int",
      },
      {
        name: "LevelSynchronizerSlotCount",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxLevelGap",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxLearnableManualSpecialMoveCount",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxAffinityItemGiftCountPerDay",
        type: "int",
        kind: "int",
      },
      {
        name: "AffinityAccumulationPerBattle",
        type: "int",
        kind: "int",
      },
      {
        name: "AffinityBonusAccumulationPerBattle",
        type: "int",
        kind: "int",
      },
      {
        name: "FullyAwakenedToken",
        type: "TokenItemMaster",
        kind: "ref",
        ref: "TokenItemMaster",
      },
      {
        name: "ModifierPassiveSlotCount",
        type: "int",
        kind: "int",
      },
      {
        name: "ModifierPassiveCandidateGroupMaxCount",
        type: "int",
        kind: "int",
      },
      {
        name: "RerollModifierPassivesConsumeCurrency",
        type: "ItemMasterWithQuantity",
        kind: "struct",
      },
      {
        name: "PurchaseShopExchangeableDurationDays",
        type: "int",
        kind: "int",
      },
      {
        name: "GachaUpgradeEffectProbability",
        type: "float",
        kind: "float",
      },
      {
        name: "GachaDoubleUpgradeEffectProbability",
        type: "float",
        kind: "float",
      },
      {
        name: "GetGuildsLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "ThresholdDaysToActive",
        type: "int",
        kind: "int",
      },
      {
        name: "NameMaxLength",
        type: "int",
        kind: "int",
      },
      {
        name: "AnnouncementMaxLength",
        type: "int",
        kind: "int",
      },
      {
        name: "AnnouncementMaxLineCount",
        type: "int",
        kind: "int",
      },
      {
        name: "DaysUntilLeaderMarkedAbsent",
        type: "int",
        kind: "int",
      },
      {
        name: "MemberLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "ViceLeaderLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "PendingEntryFormLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "CreateCost",
        type: "DiamondPayment",
        kind: "struct",
      },
      {
        name: "GuildToken",
        type: "TokenItemMaster",
        kind: "ref",
        ref: "TokenItemMaster",
      },
      {
        name: "ThreadChoicesLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "PendingReceiveLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "InitialRating",
        type: "int",
        kind: "int",
      },
      {
        name: "AvailableRerollCountPerDay",
        type: "int",
        kind: "int",
      },
      {
        name: "RerollCooldownDuration",
        type: "TimeSpan",
        kind: "struct",
      },
      {
        name: "AutoGiveUpDuration",
        type: "TimeSpan",
        kind: "struct",
      },
      {
        name: "SingleMatchingRatingExpansionOneWay",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxMatchingRatingExpansionOneWay",
        type: "int",
        kind: "int",
      },
      {
        name: "DailyRewardCarryOverWarrantyDays",
        type: "int",
        kind: "int",
      },
      {
        name: "Background",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
      },
      {
        name: "Bgm",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
      },
      {
        name: "DailyNonComplimentaryAttemptCount",
        type: "int",
        kind: "int",
      },
      {
        name: "DailyComplimentaryAttemptCount",
        type: "int",
        kind: "int",
      },
      {
        name: "NonComplimentaryAttemptCost",
        type: "DiamondPayment",
        kind: "struct",
      },
      {
        name: "PvpToken",
        type: "TokenItemMaster",
        kind: "ref",
        ref: "TokenItemMaster",
      },
      {
        name: "PlayerCount",
        type: "int",
        kind: "int",
      },
      {
        name: "MaxAttemptCount",
        type: "int",
        kind: "int",
      },
      {
        name: "RaidToken",
        type: "TokenItemMaster",
        kind: "ref",
        ref: "TokenItemMaster",
      },
      {
        name: "HalfGameTurns",
        type: "int",
        kind: "int",
      },
      {
        name: "AlmostFinishTurns",
        type: "int",
        kind: "int",
      },
      {
        name: "AdditionalTimeTurns",
        type: "int",
        kind: "int",
      },
      {
        name: "AdditionalTimeLargestScoreGap",
        type: "int",
        kind: "int",
      },
      {
        name: "SecondsPerTurn",
        type: "int",
        kind: "int",
      },
      {
        name: "TPRecoverAmount",
        type: "int",
        kind: "int",
      },
      {
        name: "BasePassCutProbability",
        type: "decimal",
        kind: "float",
      },
      {
        name: "BlockWeight",
        type: "decimal",
        kind: "float",
      },
      {
        name: "BaseShootChainProbability",
        type: "decimal",
        kind: "float",
      },
      {
        name: "ShootChainProbabilityBonus",
        type: "decimal",
        kind: "float",
      },
      {
        name: "ShootChainPowerMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "TotalShootBlockPowerAdditionMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "KeepingDistanceAfterFoul",
        type: "int",
        kind: "int",
      },
      {
        name: "BlockToWallPowerMultiplier",
        type: "decimal",
        kind: "float",
      },
      {
        name: "KickCoefficient",
        type: "decimal",
        kind: "float",
      },
      {
        name: "TechniqueCoefficient",
        type: "decimal",
        kind: "float",
      },
      {
        name: "BlockCoefficient",
        type: "decimal",
        kind: "float",
      },
      {
        name: "CatchCoefficient",
        type: "decimal",
        kind: "float",
      },
      {
        name: "ActiveFormationEffectCoefficient",
        type: "decimal",
        kind: "float",
      },
      {
        name: "TrainingRewardsMaxAccumulationHours",
        type: "int",
        kind: "int",
      },
      {
        name: "TrainingStageRewardBulkReceiveMaxLevelCount",
        type: "int",
        kind: "int",
      },
      {
        name: "InstantTrainingDuration",
        type: "double",
        kind: "float",
      },
      {
        name: "CarryOverInstantTrainingWarrantyDays",
        type: "int",
        kind: "int",
      },
      {
        name: "DailyComplimentaryInstantTrainableCount",
        type: "int",
        kind: "int",
      },
      {
        name: "DailyNonComplimentaryInstantTrainableCount",
        type: "int",
        kind: "int",
      },
      {
        name: "NonComplimentaryInstantTrainingCost",
        type: "DiamondPayment",
        kind: "struct",
      },
      {
        name: "EntrustSoccerBattleDuration",
        type: "int",
        kind: "int",
      },
      {
        name: "PrologueSkit",
        type: "SkitMaster",
        kind: "ref",
        ref: "SkitMaster",
      },
      {
        name: "MainStoryA1S1",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "MainStoryA1S2",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "AutoSwitchMainStoryStage",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "MoveSelectTutorialInAutoSwitchStage",
        type: "GameContentTutorialMaster",
        kind: "ref",
        ref: "GameContentTutorialMaster",
      },
      {
        name: "AutoSwitchNavigationTurn",
        type: "int",
        kind: "int",
      },
      {
        name: "AutoSwitchNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "AreaChangeMainStoryStage",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "AreaChangeNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "Area2Navigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "GachaUnlockMainStoryStage",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "TutorialGachaMachine",
        type: "GachaMachineMaster",
        kind: "ref",
        ref: "GachaMachineMaster",
      },
      {
        name: "MainStoryToHomeNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "HomeToGachaNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "GachaNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "GachaToHomeNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "HomeToClubHallNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "HomeToTrainingStageNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "TrainingStageToFormationNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "FormationNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "EntrustNavigationTurn",
        type: "int",
        kind: "int",
      },
      {
        name: "EntrustNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "ObtainTrainingRewardNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "SpeedChangeMainStoryStage",
        type: "MainStoryStageMaster",
        kind: "ref",
        ref: "MainStoryStageMaster",
      },
      {
        name: "SpeedChangeNavigationTurn",
        type: "int",
        kind: "int",
      },
      {
        name: "SpeedChangeNavigations",
        type: "InstructionNavigationMaster[]",
        kind: "array",
        ref: "InstructionNavigationMaster",
        element: "InstructionNavigationMaster",
      },
      {
        name: "DefaultUserName",
        type: "string",
        kind: "string",
      },
      {
        name: "DefaultUserAnnouncement",
        type: "string",
        kind: "string",
      },
      {
        name: "UserNameMaxLength",
        type: "int",
        kind: "int",
      },
      {
        name: "UserAnnouncementMaxLength",
        type: "int",
        kind: "int",
      },
      {
        name: "DefaultFavoriteCharacterCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DefaultProfileIconCode",
        type: "int",
        kind: "int",
      },
      {
        name: "DefaultTeamName",
        type: "string",
        kind: "string",
      },
      {
        name: "TeamNameMaxLength",
        type: "int",
        kind: "int",
      },
      {
        name: "AppStartTime",
        type: "DateTimeOffset",
        kind: "struct",
      },
      {
        name: "DayResetTimeJst",
        type: "SoccerTimeOnly",
        kind: "struct",
      },
      {
        name: "WeekStartDayOfWeek",
        type: "DayOfWeek",
        kind: "enum",
        enumValues: [
          {
            name: "Sunday",
            value: "0",
          },
          {
            name: "Monday",
            value: "1",
          },
          {
            name: "Tuesday",
            value: "2",
          },
          {
            name: "Wednesday",
            value: "3",
          },
          {
            name: "Thursday",
            value: "4",
          },
          {
            name: "Friday",
            value: "5",
          },
          {
            name: "Saturday",
            value: "6",
          },
        ],
      },
      {
        name: "MonthStartDayJst",
        type: "int",
        kind: "int",
      },
      {
        name: "RecommendedWorldGroupCount",
        type: "int",
        kind: "int",
      },
      {
        name: "CreateDefaultUserCandidateWorldGroupCount",
        type: "int",
        kind: "int",
      },
      {
        name: "MergeNotificationDisplayDuration",
        type: "TimeSpan",
        kind: "struct",
      },
      {
        name: "Training",
        type: "TrainingParameter",
        kind: "struct",
      },
      {
        name: "Soccer",
        type: "SoccerParameter",
        kind: "struct",
      },
      {
        name: "Guild",
        type: "GuildParameter",
        kind: "struct",
      },
      {
        name: "Raid",
        type: "RaidParameter",
        kind: "struct",
      },
      {
        name: "ClubMember",
        type: "ClubMemberParameter",
        kind: "struct",
      },
      {
        name: "Pvp",
        type: "PvpParameter",
        kind: "struct",
      },
      {
        name: "World",
        type: "WorldParameter",
        kind: "struct",
      },
      {
        name: "Inalink",
        type: "InalinkParameter",
        kind: "struct",
      },
      {
        name: "TotalPower",
        type: "TotalPowerParameter",
        kind: "struct",
      },
      {
        name: "UserProfile",
        type: "UserProfileParameter",
        kind: "struct",
      },
      {
        name: "LoginBonus",
        type: "LoginBonusParameter",
        kind: "struct",
      },
      {
        name: "Chat",
        type: "ChatParameter",
        kind: "struct",
      },
      {
        name: "Gacha",
        type: "GachaParameter",
        kind: "struct",
      },
      {
        name: "Tutorial",
        type: "TutorialParameter",
        kind: "struct",
      },
      {
        name: "BattlePass",
        type: "BattlePassParameter",
        kind: "struct",
      },
      {
        name: "AppReview",
        type: "AppReviewParameter",
        kind: "struct",
      },
      {
        name: "Event",
        type: "EventParameter",
        kind: "struct",
      },
    ],
  },
  PassiveMaster: {
    file: "LGAマスター - パッシブ.tsv",
    fullName: "Soccer.Shared.PassiveMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "DescriptionKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Rank",
        type: "PassiveRank",
        kind: "enum",
        enumValues: [
          {
            name: "S",
            value: "0",
          },
          {
            name: "A",
            value: "1",
          },
          {
            name: "B",
            value: "2",
          },
        ],
      },
      {
        name: "Triggers",
        type: "PassiveTriggerMaster[]",
        kind: "array",
        ref: "PassiveTriggerMaster",
        element: "PassiveTriggerMaster",
      },
      {
        name: "TotalPowerAddition",
        type: "int",
        kind: "int",
      },
    ],
  },
  PassiveTotalPowerAdditionMaster: {
    file: "LGAマスター - パッシブ総合能力加算値.tsv",
    fullName: "Soccer.Shared.PassiveTotalPowerAdditionMaster",
    extends: null,
    columns: [
      {
        name: "PassiveRank",
        type: "PassiveRank",
        kind: "enum",
        enumValues: [
          {
            name: "S",
            value: "0",
          },
          {
            name: "A",
            value: "1",
          },
          {
            name: "B",
            value: "2",
          },
        ],
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "TotalPowerAddition",
        type: "int",
        kind: "int",
      },
    ],
  },
  PassiveTriggerMaster: {
    file: "LGAマスター - パッシブトリガー.tsv",
    fullName: "Soccer.Shared.PassiveTriggerMaster",
    extends: null,
    columns: [
      {
        name: "StatusEffect",
        type: "StatusEffectMaster",
        kind: "ref",
        ref: "StatusEffectMaster",
      },
      {
        name: "BeginCondition",
        type: "StatusEffectConditionMaster",
        kind: "ref",
        ref: "StatusEffectConditionMaster",
      },
      {
        name: "EndCondition",
        type: "StatusEffectConditionMaster",
        kind: "ref",
        ref: "StatusEffectConditionMaster",
      },
      {
        name: "TargetPlayer",
        type: "string",
        kind: "string",
      },
      {
        name: "AllowMultipleEffects",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  PlaywrightBookMaster: {
    file: "LGAマスター - 試合脚本.tsv",
    fullName: "Soccer.Shared.PlaywrightBookMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Script",
        type: "string",
        kind: "string",
      },
    ],
  },
  PreferredAreaRankMaster: {
    file: "LGAマスター - 得意エリアランク.tsv",
    fullName: "Soccer.Shared.PreferredAreaRankMaster",
    extends: null,
    columns: [
      {
        name: "Rank",
        type: "int",
        kind: "int",
      },
      {
        name: "Multiplier",
        type: "decimal",
        kind: "float",
      },
    ],
  },
  PvPMatchingSlotMaster: {
    file: "LGAマスター - PvPマッチング枠.tsv",
    fullName: "Soccer.Shared.PvPMatchingSlotMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Slot",
        type: "int",
        kind: "int",
      },
      {
        name: "RelativeLowestRatingInclusive",
        type: "int",
        kind: "int",
      },
      {
        name: "RelativeHighestRatingExclusive",
        type: "int",
        kind: "int",
      },
    ],
  },
  PvPNpcTeamMaster: {
    file: "LGAマスター - PvPNPCチーム.tsv",
    fullName: "Soccer.Shared.PvPNpcTeamMaster",
    extends: "EnemyTeamMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "Players",
        type: "IList<NonUserPlayerMaster>",
        kind: "list",
        ref: "NonUserPlayerMaster",
        element: "NonUserPlayerMaster",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "Director",
        type: "DirectorItemMaster",
        kind: "ref",
        ref: "DirectorItemMaster",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "DirectorLevel",
        type: "int",
        kind: "int",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "BattleFormat",
        type: "BattleFormat",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "SoccerBattle",
            value: "1",
          },
        ],
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "TeamUniform",
        type: "TeamUniformItemMaster",
        kind: "ref",
        ref: "TeamUniformItemMaster",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "TeamEmblem",
        type: "ProfileIconItemMaster",
        kind: "ref",
        ref: "ProfileIconItemMaster",
        inherited: true,
        from: "EnemyTeamMaster",
      },
      {
        name: "Rating",
        type: "int",
        kind: "int",
      },
      {
        name: "EquipmentLevel",
        type: "int",
        kind: "int",
      },
    ],
    relatedFiles: ["LGAマスター - PvPNPCチーム.tsv", "LGAマスター - PvPNPCチームプレイヤー.tsv"],
  },
  PvpPlacementMaster: {
    file: "LGAマスター - PvP振り分け戦.tsv",
    fullName: "Soccer.Shared.PvpPlacementMaster",
    extends: null,
    columns: [
      {
        name: "AttemptCount",
        type: "int",
        kind: "int",
      },
      {
        name: "NpcTeams",
        type: "PvPNpcTeamMaster[]",
        kind: "array",
        ref: "PvPNpcTeamMaster",
        element: "PvPNpcTeamMaster",
      },
    ],
  },
  PvpRankMaster: {
    file: "LGAマスター - PvP階級.tsv",
    fullName: "Soccer.Shared.PvpRankMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "RatingLowerLimit",
        type: "int",
        kind: "int",
      },
      {
        name: "BaseRatingAddition",
        type: "float",
        kind: "float",
      },
      {
        name: "MaxRatingChange",
        type: "float",
        kind: "float",
      },
      {
        name: "MatchingSlots",
        type: "PvPMatchingSlotMaster[]",
        kind: "array",
        ref: "PvPMatchingSlotMaster",
        element: "PvPMatchingSlotMaster",
      },
      {
        name: "NewRatingOnSeasonChange",
        type: "int",
        kind: "int",
      },
      {
        name: "EmblemAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "EveryBattleReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "DailyReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "WeeklyReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "SeasonReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "Prev",
        type: "PvpRankMaster",
        kind: "ref",
        ref: "PvpRankMaster",
      },
      {
        name: "Next",
        type: "PvpRankMaster",
        kind: "ref",
        ref: "PvpRankMaster",
      },
    ],
  },
  PvpSeasonMaster: {
    file: "LGAマスター - PvPシーズン.tsv",
    fullName: "Soccer.Shared.PvpSeasonMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "GamePeriodStartsAt",
        type: "DateTimeOffset",
        kind: "struct",
      },
      {
        name: "RestPeriodStartsAt",
        type: "DateTimeOffset",
        kind: "struct",
      },
      {
        name: "DefaultField",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
      },
      {
        name: "FieldOverrides",
        type: "PvpSeasonFieldOverride[]",
        kind: "array",
        element: "PvpSeasonFieldOverride",
      },
      {
        name: "Prev",
        type: "PvpSeasonMaster",
        kind: "ref",
        ref: "PvpSeasonMaster",
      },
      {
        name: "Next",
        type: "PvpSeasonMaster",
        kind: "ref",
        ref: "PvpSeasonMaster",
      },
      {
        name: "RankingRewards",
        type: "List<PvpSeasonRankingRewardMaster>",
        kind: "list",
        ref: "PvpSeasonRankingRewardMaster",
        element: "PvpSeasonRankingRewardMaster",
      },
    ],
  },
  PvpSeasonRankingRewardMaster: {
    file: "LGAマスター - PvPシーズンランキング報酬.tsv",
    fullName: "Soccer.Shared.PvpSeasonRankingRewardMaster",
    extends: null,
    columns: [
      {
        name: "Season",
        type: "PvpSeasonMaster",
        kind: "ref",
        ref: "PvpSeasonMaster",
      },
      {
        name: "HighestOneOriginRank",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
      {
        name: "Next",
        type: "PvpSeasonRankingRewardMaster",
        kind: "ref",
        ref: "PvpSeasonRankingRewardMaster",
      },
    ],
  },
  RaidCycleMaster: {
    file: "LGAマスター - 試練サイクル.tsv",
    fullName: "Soccer.Shared.RaidCycleMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Groups",
        type: "RaidGroupMaster[]",
        kind: "array",
        ref: "RaidGroupMaster",
        element: "RaidGroupMaster",
      },
    ],
  },
  RaidDifficultyMaster: {
    file: "LGAマスター - 試練難易度.tsv",
    fullName: "Soccer.Shared.RaidDifficultyMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
      {
        name: "ShootScoreCoefficient",
        type: "float",
        kind: "float",
      },
      {
        name: "ShootClearCoefficient",
        type: "float",
        kind: "float",
      },
      {
        name: "BlockBaseScore",
        type: "int",
        kind: "int",
      },
      {
        name: "BlockClearCoefficient",
        type: "float",
        kind: "float",
      },
    ],
  },
  RaidGroupMaster: {
    file: "LGAマスター - 試練グループ.tsv",
    fullName: "Soccer.Shared.RaidGroupMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Type",
        type: "RaidType",
        kind: "enum",
        enumValues: [
          {
            name: "Shoot",
            value: "0",
          },
          {
            name: "Block",
            value: "1",
          },
        ],
      },
      {
        name: "Element",
        type: "CharacterElement",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Wind",
            value: "1",
          },
          {
            name: "Forest",
            value: "2",
          },
          {
            name: "Fire",
            value: "3",
          },
          {
            name: "Mountain",
            value: "4",
          },
        ],
      },
      {
        name: "EnemyCharacter",
        type: "CharacterMaster",
        kind: "ref",
        ref: "CharacterMaster",
      },
      {
        name: "Field",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
      },
      {
        name: "RankingRewards",
        type: "RaidRankingRewardMaster[]",
        kind: "array",
        ref: "RaidRankingRewardMaster",
        element: "RaidRankingRewardMaster",
      },
      {
        name: "ScoreRewards",
        type: "RaidScoreRewardMaster[]",
        kind: "array",
        ref: "RaidScoreRewardMaster",
        element: "RaidScoreRewardMaster",
      },
      {
        name: "RecommendedCharacters",
        type: "CharacterMaster[]",
        kind: "array",
        ref: "CharacterMaster",
        element: "CharacterMaster",
      },
      {
        name: "Raids",
        type: "List<RaidMaster>",
        kind: "list",
        ref: "RaidMaster",
        element: "RaidMaster",
      },
    ],
  },
  RaidMaster: {
    file: "LGAマスター - 試練.tsv",
    fullName: "Soccer.Shared.RaidMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "EnemyPower",
        type: "int",
        kind: "int",
      },
      {
        name: "Difficulty",
        type: "RaidDifficultyMaster",
        kind: "ref",
        ref: "RaidDifficultyMaster",
      },
      {
        name: "EnemyMove",
        type: "SpecialMoveGrowthMaster",
        kind: "ref",
        ref: "SpecialMoveGrowthMaster",
      },
      {
        name: "Group",
        type: "RaidGroupMaster",
        kind: "ref",
        ref: "RaidGroupMaster",
      },
      {
        name: "NextDifficultyRaid",
        type: "RaidMaster",
        kind: "ref",
        ref: "RaidMaster",
      },
    ],
  },
  RaidRankingRewardMaster: {
    file: "LGAマスター - 試練ランキング報酬テーブル.tsv",
    fullName: "Soccer.Shared.RaidRankingRewardMaster",
    extends: null,
    columns: [
      {
        name: "HighestRank",
        type: "long",
        kind: "int",
      },
      {
        name: "LowestRank",
        type: "long",
        kind: "int",
        nullable: true,
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
    ],
  },
  RaidScoreRewardMaster: {
    file: "LGAマスター - 試練スコア報酬テーブル.tsv",
    fullName: "Soccer.Shared.RaidScoreRewardMaster",
    extends: null,
    columns: [
      {
        name: "Score",
        type: "int",
        kind: "int",
      },
      {
        name: "Reward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
      },
    ],
  },
  BaseScheduleMaster: {
    file: "LGAマスター - スケジュール.tsv",
    fullName: "Soccer.Shared.BaseScheduleMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "ScheduleTargetType",
        type: "ScheduleTargetType",
        kind: "enum",
        enumValues: [
          {
            name: "Gacha",
            value: "0",
          },
          {
            name: "LoginBonus",
            value: "1",
          },
          {
            name: "PvP",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "StoreExchangeProduct",
            value: "5",
          },
          {
            name: "Event",
            value: "6",
          },
          {
            name: "ShopCategory",
            value: "7",
          },
        ],
      },
      {
        name: "ScheduleTargetCode",
        type: "int",
        kind: "int",
      },
      {
        name: "Period",
        type: "Period",
        kind: "struct",
      },
    ],
  },
  ShapeModelVariationMaster: {
    file: "LGAマスター - 体型着こなし.tsv",
    fullName: "Soccer.Shared.ShapeModelVariationMaster",
    extends: null,
    columns: [
      {
        name: "Shape",
        type: "CharacterShape",
        kind: "enum",
        enumValues: [
          {
            name: "Undefined",
            value: "0",
          },
          {
            name: "MaleAverage",
            value: "1",
          },
          {
            name: "MaleSmall",
            value: "2",
          },
          {
            name: "MaleFat",
            value: "3",
          },
          {
            name: "MaleTall",
            value: "4",
          },
          {
            name: "MaleMuscular",
            value: "5",
          },
          {
            name: "MaleLarge",
            value: "6",
          },
          {
            name: "MaleTallAndMuscular",
            value: "7",
          },
          {
            name: "MaleMuscularThickNeck",
            value: "8",
          },
          {
            name: "MaleLargeThickNeck",
            value: "9",
          },
          {
            name: "FemaleAverage",
            value: "10",
          },
          {
            name: "FemaleSmall",
            value: "11",
          },
          {
            name: "FemaleFat",
            value: "12",
          },
          {
            name: "FemaleTall",
            value: "13",
          },
          {
            name: "FemaleMuscular",
            value: "14",
          },
          {
            name: "FemaleLarge",
            value: "15",
          },
          {
            name: "FemaleTallAndMuscular",
            value: "16",
          },
          {
            name: "FemaleMuscularThickNeck",
            value: "17",
          },
          {
            name: "FemaleLargeThickNeck",
            value: "18",
          },
        ],
      },
      {
        name: "Source",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
      {
        name: "Variation",
        type: "CharacterModelSetMaster",
        kind: "ref",
        ref: "CharacterModelSetMaster",
      },
    ],
  },
  ShopCategoryMaster: {
    file: "LGAマスター - ショップカテゴリー.tsv",
    fullName: "Soccer.Shared.ShopCategoryMaster",
    extends: "ISchedulableByScheduleMaster<ScheduleMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Type",
        type: "ShopCategoryType",
        kind: "enum",
        enumValues: [
          {
            name: "Campaign",
            value: "0",
          },
          {
            name: "Raid",
            value: "1",
          },
          {
            name: "Guild",
            value: "2",
          },
          {
            name: "Pvp",
            value: "3",
          },
          {
            name: "FullyAwakened",
            value: "4",
          },
          {
            name: "FullyAwakenedConversion",
            value: "5",
          },
          {
            name: "Event",
            value: "6",
          },
        ],
      },
      {
        name: "RequiredContentType",
        type: "GameContentType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "ClubHall",
            value: "1",
          },
          {
            name: "TrainingStage",
            value: "2",
          },
          {
            name: "Mission",
            value: "3",
          },
          {
            name: "BattlePass",
            value: "4",
          },
          {
            name: "Scout",
            value: "5",
          },
          {
            name: "Raid",
            value: "6",
          },
          {
            name: "Equipment",
            value: "7",
          },
          {
            name: "Affinity",
            value: "8",
          },
          {
            name: "SpecialMoveManual",
            value: "9",
          },
          {
            name: "ConnectionBoard",
            value: "10",
          },
          {
            name: "ClubHouse",
            value: "11",
          },
          {
            name: "Guild",
            value: "12",
          },
          {
            name: "GvE",
            value: "13",
          },
          {
            name: "ExtraCup",
            value: "14",
          },
          {
            name: "PvP",
            value: "15",
          },
          {
            name: "Director",
            value: "16",
          },
          {
            name: "Event",
            value: "17",
          },
          {
            name: "MoveSelect",
            value: "18",
          },
          {
            name: "Story",
            value: "19",
          },
          {
            name: "Shop",
            value: "20",
          },
          {
            name: "PassiveModifier",
            value: "21",
          },
          {
            name: "Store",
            value: "22",
          },
        ],
      },
      {
        name: "TabOrder",
        type: "int",
        kind: "int",
      },
      {
        name: "TabIconAssetName",
        type: "string",
        kind: "string",
      },
      {
        name: "TabTextKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "HasSchedule",
        type: "bool",
        kind: "bool",
      },
      {
        name: "EventMaster",
        type: "EventMaster",
        kind: "ref",
        ref: "EventMaster",
      },
    ],
  },
  ShopItemMaster: {
    file: "LGAマスター - ショップ.tsv",
    fullName: "Soccer.Shared.ShopItemMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Category",
        type: "ShopCategoryMaster",
        kind: "ref",
        ref: "ShopCategoryMaster",
      },
      {
        name: "Price",
        type: "ItemMasterWithQuantity",
        kind: "struct",
      },
      {
        name: "Goods",
        type: "ItemMasterWithQuantity",
        kind: "struct",
      },
      {
        name: "RequiredGuildRank",
        type: "GuildRankMaster",
        kind: "ref",
        ref: "GuildRankMaster",
      },
      {
        name: "StockQuantity",
        type: "uint",
        kind: "int",
        nullable: true,
      },
      {
        name: "RestockInterval",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
      },
    ],
  },
  SkitMaster: {
    file: "LGAマスター - スキット.tsv",
    fullName: "Soccer.Shared.SkitMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Path",
        type: "string",
        kind: "string",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
      },
    ],
  },
  SpecialMoveLevelUpRecipeMasterData: {
    file: "LGAマスター - 必殺技 - 強化素材消費量.tsv",
    fullName: "Soccer.Shared.SpecialMoveLevelUpRecipeMasterData",
    extends: null,
    columns: [
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "RequirementsToNext",
        type: "ItemMasterWithQuantity[]",
        kind: "array",
        element: "ItemMasterWithQuantity",
      },
      {
        name: "Next",
        type: "SpecialMoveLevelUpRecipeMasterData",
        kind: "struct",
      },
    ],
  },
  SpecialMoveMaster: {
    file: "LGAマスター - 必殺技.tsv",
    fullName: "Soccer.Shared.SpecialMoveMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Type",
        type: "MoveType",
        kind: "enum",
        enumValues: [
          {
            name: "Shoot",
            value: "0",
          },
          {
            name: "Dribble",
            value: "1",
          },
          {
            name: "Block",
            value: "2",
          },
          {
            name: "Keeper",
            value: "3",
          },
        ],
      },
      {
        name: "CanBlockShoot",
        type: "bool",
        kind: "bool",
      },
      {
        name: "CanChain",
        type: "bool",
        kind: "bool",
      },
      {
        name: "Element",
        type: "CharacterElement",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Wind",
            value: "1",
          },
          {
            name: "Forest",
            value: "2",
          },
          {
            name: "Fire",
            value: "3",
          },
          {
            name: "Mountain",
            value: "4",
          },
        ],
      },
      {
        name: "PunchDistance",
        type: "int",
        kind: "int",
      },
      {
        name: "IsSpecialMove",
        type: "bool",
        kind: "bool",
      },
      {
        name: "Growths",
        type: "SpecialMoveGrowthMaster[]",
        kind: "array",
        ref: "SpecialMoveGrowthMaster",
        element: "SpecialMoveGrowthMaster",
      },
      {
        name: "Partners",
        type: "SpecialMovePartnerMaster[]",
        kind: "array",
        ref: "SpecialMovePartnerMaster",
        element: "SpecialMovePartnerMaster",
      },
    ],
    relatedFiles: [
      "LGAマスター - 必殺技.tsv",
      "LGAマスター - 必殺技 - 成長.tsv",
      "LGAマスター - 必殺技 - パートナー.tsv",
    ],
  },
  SpecialMoveTotalPowerAdditionMaster: {
    file: "LGAマスター - 必殺技総合能力加算値.tsv",
    fullName: "Soccer.Shared.SpecialMoveTotalPowerAdditionMaster",
    extends: null,
    columns: [
      {
        name: "MoveSource",
        type: "MoveSource",
        kind: "enum",
        enumValues: [
          {
            name: "Normal",
            value: "0",
          },
          {
            name: "Growth",
            value: "1",
          },
          {
            name: "Manual",
            value: "2",
          },
        ],
      },
      {
        name: "Level",
        type: "int",
        kind: "int",
      },
      {
        name: "TotalPowerAddition",
        type: "int",
        kind: "int",
      },
    ],
  },
  StaffModelSetMaster: {
    file: "LGAマスター - その他キャラクターモデル.tsv",
    fullName: "Soccer.Shared.StaffModelSetMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "ModelSetType",
        type: "StaffModelSetType",
        kind: "enum",
        enumValues: [
          {
            name: "Other",
            value: "0",
          },
          {
            name: "Character",
            value: "1",
          },
          {
            name: "Director",
            value: "2",
          },
        ],
      },
      {
        name: "Shape",
        type: "CharacterShape",
        kind: "enum",
        enumValues: [
          {
            name: "Undefined",
            value: "0",
          },
          {
            name: "MaleAverage",
            value: "1",
          },
          {
            name: "MaleSmall",
            value: "2",
          },
          {
            name: "MaleFat",
            value: "3",
          },
          {
            name: "MaleTall",
            value: "4",
          },
          {
            name: "MaleMuscular",
            value: "5",
          },
          {
            name: "MaleLarge",
            value: "6",
          },
          {
            name: "MaleTallAndMuscular",
            value: "7",
          },
          {
            name: "MaleMuscularThickNeck",
            value: "8",
          },
          {
            name: "MaleLargeThickNeck",
            value: "9",
          },
          {
            name: "FemaleAverage",
            value: "10",
          },
          {
            name: "FemaleSmall",
            value: "11",
          },
          {
            name: "FemaleFat",
            value: "12",
          },
          {
            name: "FemaleTall",
            value: "13",
          },
          {
            name: "FemaleMuscular",
            value: "14",
          },
          {
            name: "FemaleLarge",
            value: "15",
          },
          {
            name: "FemaleTallAndMuscular",
            value: "16",
          },
          {
            name: "FemaleMuscularThickNeck",
            value: "17",
          },
          {
            name: "FemaleLargeThickNeck",
            value: "18",
          },
        ],
      },
      {
        name: "ChestSize",
        type: "CharacterChestSize",
        kind: "enum",
        enumValues: [
          {
            name: "Medium",
            value: "0",
          },
          {
            name: "Small",
            value: "1",
          },
          {
            name: "Large",
            value: "2",
          },
        ],
        nullable: true,
      },
      {
        name: "Personality",
        type: "CharacterPersonality",
        kind: "enum",
        enumValues: [
          {
            name: "Daring",
            value: "0",
          },
          {
            name: "Cool",
            value: "1",
          },
          {
            name: "Cheerful",
            value: "2",
          },
          {
            name: "Elegant",
            value: "3",
          },
        ],
      },
      {
        name: "ShapeCorrectionCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "PreferStandingCollar",
        type: "bool",
        kind: "bool",
      },
      {
        name: "PreferShirtOut",
        type: "bool",
        kind: "bool",
      },
      {
        name: "FaceCode",
        type: "int",
        kind: "int",
      },
      {
        name: "UniformCode",
        type: "int",
        kind: "int",
      },
      {
        name: "SkinCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "GloveCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "ShoesCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "AccessoryCodes",
        type: "Int32[]",
        kind: "array",
        element: "int",
      },
      {
        name: "CaptainMarkCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "UniformNumberCode",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "DefaultUniformNumber",
        type: "int",
        kind: "int",
        nullable: true,
      },
      {
        name: "NameOnUniformKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
    ],
  },
  StatusEffectConditionMaster: {
    file: "LGAマスター - 状態効果条件.tsv",
    fullName: "Soccer.Shared.StatusEffectConditionMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Type",
        type: "StatusEffectConditionType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "BattleStart",
            value: "1",
          },
          {
            name: "TurnStart",
            value: "2",
          },
          {
            name: "PlayerCountOnBattleStart",
            value: "3",
          },
          {
            name: "ScoreLeadOnKickOffPhase",
            value: "4",
          },
          {
            name: "AfterGoal",
            value: "5",
          },
          {
            name: "AfterShootBlocked",
            value: "6",
          },
          {
            name: "AfterShootBlockMove",
            value: "7",
          },
          {
            name: "AfterDribbleMove",
            value: "8",
          },
          {
            name: "AfterDribbleBlockMove",
            value: "9",
          },
          {
            name: "AfterKeeperMove",
            value: "10",
          },
          {
            name: "AfterPassed",
            value: "11",
          },
          {
            name: "AfterPassReceived",
            value: "12",
          },
          {
            name: "AfterPassCut",
            value: "13",
          },
          {
            name: "BeforeShootChain",
            value: "14",
          },
          {
            name: "AfterMoveUse",
            value: "15",
          },
          {
            name: "MoveCountOnBattleStart",
            value: "16",
          },
          {
            name: "AfterCritical",
            value: "17",
          },
          {
            name: "InsideAreaAfterMoved",
            value: "18",
          },
          {
            name: "OutsideAreaAfterMoved",
            value: "19",
          },
        ],
      },
      {
        name: "Parameters",
        type: "String[]",
        kind: "array",
        element: "string",
      },
    ],
  },
  StatusEffectGroupMaster: {
    file: "LGAマスター - 状態効果グループ.tsv",
    fullName: "Soccer.Shared.StatusEffectGroupMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Min",
        type: "int",
        kind: "int",
      },
      {
        name: "Max",
        type: "int",
        kind: "int",
      },
      {
        name: "AggregationRule",
        type: "StatusEffectAggregationRule",
        kind: "enum",
        enumValues: [
          {
            name: "Sum",
            value: "0",
          },
          {
            name: "Max",
            value: "1",
          },
        ],
      },
    ],
  },
  StatusEffectGrowthTableMaster: {
    file: "LGAマスター - 状態効果成長テーブル.tsv",
    fullName: "Soccer.Shared.StatusEffectGrowthTableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "LevelToValue",
        type: "Dictionary<Int32, Int32>",
        kind: "dict",
        key: "int",
        value: "int",
      },
    ],
  },
  StatusEffectMaster: {
    file: "LGAマスター - 状態効果.tsv",
    fullName: "Soccer.Shared.StatusEffectMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Type",
        type: "StatusEffectType",
        kind: "enum",
        enumValues: [
          {
            name: "AddMovePower",
            value: "0",
          },
          {
            name: "AddMoveRange",
            value: "1",
          },
          {
            name: "AddPassCutProbability",
            value: "2",
          },
          {
            name: "AddTPCost",
            value: "3",
          },
          {
            name: "AddCooldownTime",
            value: "4",
          },
          {
            name: "AddCriticalProbability",
            value: "5",
          },
          {
            name: "AddShootChainProbability",
            value: "6",
          },
          {
            name: "AddMaxTP",
            value: "7",
          },
          {
            name: "AddCurrentTP",
            value: "8",
          },
          {
            name: "AddKick",
            value: "9",
          },
          {
            name: "AddTechnique",
            value: "10",
          },
          {
            name: "AddBlock",
            value: "11",
          },
          {
            name: "AddCatch",
            value: "12",
          },
          {
            name: "AddSpeed",
            value: "13",
          },
          {
            name: "AddAllParameters",
            value: "14",
          },
          {
            name: "AddFoulProbability",
            value: "15",
          },
        ],
      },
      {
        name: "TargetMove",
        type: "string",
        kind: "string",
      },
      {
        name: "Group",
        type: "StatusEffectGroupMaster",
        kind: "ref",
        ref: "StatusEffectGroupMaster",
      },
      {
        name: "GrowthTable",
        type: "StatusEffectGrowthTableMaster",
        kind: "ref",
        ref: "StatusEffectGrowthTableMaster",
      },
    ],
  },
  StoreCategoryMaster: {
    file: "LGAマスター - ストア - カテゴリー.tsv",
    fullName: "Soccer.Shared.StoreCategoryMaster",
    extends: null,
    columns: [
      {
        name: "Category",
        type: "StoreCategory",
        kind: "enum",
        enumValues: [
          {
            name: "Charge",
            value: "1",
          },
          {
            name: "SpecialSale",
            value: "2",
          },
          {
            name: "LimitedTime",
            value: "3",
          },
          {
            name: "RegularUpdate",
            value: "4",
          },
          {
            name: "Vip",
            value: "5",
          },
          {
            name: "BonusPass",
            value: "6",
          },
          {
            name: "BattlePass",
            value: "7",
          },
          {
            name: "Offer",
            value: "8",
          },
        ],
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
    ],
  },
  StoreItemTableMaster: {
    file: "LGAマスター - ストア - アイテムテーブル.tsv",
    fullName: "Soccer.Shared.StoreItemTableMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "Items",
        type: "ItemMasterWithQuantity[]",
        kind: "array",
        element: "ItemMasterWithQuantity",
      },
      {
        name: "ExtraItems",
        type: "ItemMasterWithQuantity[]",
        kind: "array",
        element: "ItemMasterWithQuantity",
      },
    ],
  },
  ExternalLinkProductMaster: {
    file: "LGAマスター - ストア - 外部決済商品.tsv",
    fullName: "Soccer.Shared.ExternalLinkProductMaster",
    extends: "LinkProductMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Category",
        type: "StoreCategoryMaster",
        kind: "ref",
        ref: "StoreCategoryMaster",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Price",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "CurrencyCode",
        type: "string",
        kind: "string",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Table",
        type: "StoreItemTableMaster",
        kind: "ref",
        ref: "StoreItemTableMaster",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "GrantPaidDiamond",
        type: "ItemMasterWithQuantity",
        kind: "struct",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "DisplayPriority",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "IsSaleEnabled",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "RightsType",
        type: "StoreRightsTargetType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "BonusPass",
            value: "1",
          },
          {
            name: "OfferStep",
            value: "2",
          },
        ],
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "RightsTargetCode",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "ProductGroupId",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "StockQuantity",
        type: "uint",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "IntervalSeconds",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "HasSchedule",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Period",
        type: "Period",
        kind: "struct",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "ViewType",
        type: "StoreProductViewType",
        kind: "enum",
        enumValues: [
          {
            name: "Card",
            value: "0",
          },
          {
            name: "Banner",
            value: "1",
          },
          {
            name: "BonusPassNormal",
            value: "2",
          },
          {
            name: "BonusPassPremium",
            value: "3",
          },
          {
            name: "None",
            value: "4",
          },
        ],
        inherited: true,
        from: "LinkProductMaster",
      },
    ],
  },
  InAppLinkProductMaster: {
    file: "LGAマスター - ストア - 内部決済商品.tsv",
    fullName: "Soccer.Shared.InAppLinkProductMaster",
    extends: "LinkProductMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Description",
        type: "string",
        kind: "string",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Category",
        type: "StoreCategoryMaster",
        kind: "ref",
        ref: "StoreCategoryMaster",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Price",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "CurrencyCode",
        type: "string",
        kind: "string",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Table",
        type: "StoreItemTableMaster",
        kind: "ref",
        ref: "StoreItemTableMaster",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "GrantPaidDiamond",
        type: "ItemMasterWithQuantity",
        kind: "struct",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "DisplayPriority",
        type: "int",
        kind: "int",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "IsSaleEnabled",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "RightsType",
        type: "StoreRightsTargetType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "BonusPass",
            value: "1",
          },
          {
            name: "OfferStep",
            value: "2",
          },
        ],
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "RightsTargetCode",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "ProductGroupId",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "StockQuantity",
        type: "uint",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "IntervalSeconds",
        type: "int",
        kind: "int",
        nullable: true,
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "HasSchedule",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "Period",
        type: "Period",
        kind: "struct",
        inherited: true,
        from: "LinkProductMaster",
      },
      {
        name: "ViewType",
        type: "StoreProductViewType",
        kind: "enum",
        enumValues: [
          {
            name: "Card",
            value: "0",
          },
          {
            name: "Banner",
            value: "1",
          },
          {
            name: "BonusPassNormal",
            value: "2",
          },
          {
            name: "BonusPassPremium",
            value: "3",
          },
          {
            name: "None",
            value: "4",
          },
        ],
        inherited: true,
        from: "LinkProductMaster",
      },
    ],
  },
  StoreExchangeProductMaster: {
    file: "LGAマスター - ストア - 交換商品.tsv",
    fullName: "Soccer.Shared.StoreExchangeProductMaster",
    extends: "ISchedulableByScheduleMaster<ScheduleMaster>",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "NameKey",
        type: "LocalizationKey",
        kind: "localizationKey",
      },
      {
        name: "Category",
        type: "StoreCategoryMaster",
        kind: "ref",
        ref: "StoreCategoryMaster",
      },
      {
        name: "StockQuantity",
        type: "uint",
        kind: "int",
        nullable: true,
      },
      {
        name: "DisplayPriority",
        type: "int",
        kind: "int",
      },
      {
        name: "Table",
        type: "StoreItemTableMaster",
        kind: "ref",
        ref: "StoreItemTableMaster",
      },
      {
        name: "Price",
        type: "ItemMasterWithQuantity",
        kind: "struct",
      },
      {
        name: "RestockInterval",
        type: "RenewIntervalType",
        kind: "enum",
        enumValues: [
          {
            name: "None",
            value: "0",
          },
          {
            name: "Daily",
            value: "1",
          },
          {
            name: "Weekly",
            value: "2",
          },
          {
            name: "Monthly",
            value: "3",
          },
        ],
      },
      {
        name: "IsSaleEnabled",
        type: "bool",
        kind: "bool",
      },
      {
        name: "ViewType",
        type: "StoreProductViewType",
        kind: "enum",
        enumValues: [
          {
            name: "Card",
            value: "0",
          },
          {
            name: "Banner",
            value: "1",
          },
          {
            name: "BonusPassNormal",
            value: "2",
          },
          {
            name: "BonusPassPremium",
            value: "3",
          },
          {
            name: "None",
            value: "4",
          },
        ],
      },
      {
        name: "HasSchedule",
        type: "bool",
        kind: "bool",
      },
    ],
  },
  TrainingShowcaseMaster: {
    file: "LGAマスター - 部活演出.tsv",
    fullName: "Soccer.Shared.TrainingShowcaseMaster",
    extends: null,
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
      },
      {
        name: "TimelineName",
        type: "string",
        kind: "string",
      },
      {
        name: "ScenePath",
        type: "string",
        kind: "string",
      },
      {
        name: "PreferredPositionFilter",
        type: "HashSet<CharacterPosition>",
        kind: "list",
        enumValues: [
          {
            name: "FW",
            value: "0",
          },
          {
            name: "MF",
            value: "1",
          },
          {
            name: "DF",
            value: "2",
          },
          {
            name: "GK",
            value: "3",
          },
        ],
        element: "CharacterPosition",
      },
      {
        name: "GroupCode",
        type: "int",
        kind: "int",
      },
    ],
  },
  TrainingStageMaster: {
    file: "LGAマスター - 部活ステージ.tsv",
    fullName: "Soccer.Shared.TrainingStageMaster",
    extends: "StageMaster",
    columns: [
      {
        name: "Code",
        type: "int",
        kind: "int",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Name",
        type: "string",
        kind: "string",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleSkitCode",
        type: "BattleSkitCode",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "StartSituation",
        type: "BattleStartSituation",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SpecialFinishCondition",
        type: "BattleSpecialFinishCondition",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "HighlightAvailability",
        type: "StageHighlightAvailability",
        kind: "enum",
        enumValues: [
          {
            name: "Available",
            value: "0",
          },
          {
            name: "AvailableAfterClear",
            value: "1",
          },
          {
            name: "Unavailable",
            value: "2",
          },
        ],
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsBossStage",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "IsAlwaysVictory",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "SendClearGuildFeed",
        type: "bool",
        kind: "bool",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FirstTimeReward",
        type: "FixedDropTableMaster",
        kind: "ref",
        ref: "FixedDropTableMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BattleBgmMaster",
        type: "BattleBgmMaster",
        kind: "ref",
        ref: "BattleBgmMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "EnemyTeam",
        type: "EnemyTeamSetting",
        kind: "struct",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "BackgroundMaster",
        type: "BackgroundMaster",
        kind: "ref",
        ref: "BackgroundMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "FieldMaster",
        type: "FieldMaster",
        kind: "ref",
        ref: "FieldMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "CommentaryMaster",
        type: "CommentaryMaster",
        kind: "ref",
        ref: "CommentaryMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "PlaywrightBookMaster",
        type: "PlaywrightBookMaster",
        kind: "ref",
        ref: "PlaywrightBookMaster",
        inherited: true,
        from: "StageMaster",
      },
      {
        name: "Prev",
        type: "TrainingStageMaster",
        kind: "ref",
        ref: "TrainingStageMaster",
      },
      {
        name: "Next",
        type: "TrainingStageMaster",
        kind: "ref",
        ref: "TrainingStageMaster",
      },
      {
        name: "LotteryReward",
        type: "LotteryDropTableMasterWithLot",
        kind: "struct",
      },
      {
        name: "CoinAmountPerHour",
        type: "int",
        kind: "int",
      },
      {
        name: "PointAmountPerHour",
        type: "int",
        kind: "int",
      },
      {
        name: "ExpAmountPerHour",
        type: "int",
        kind: "int",
      },
    ],
  },
  WorldGroupMaster: {
    file: "LGAマスター - ワールドグループ.tsv",
    fullName: "Soccer.Shared.WorldGroupMaster",
    extends: null,
    columns: [
      {
        name: "Id",
        type: "ushort",
        kind: "int",
      },
      {
        name: "WorldIds",
        type: "UInt16[]",
        kind: "array",
        element: "ushort",
      },
      {
        name: "StartTime",
        type: "DateTimeOffset",
        kind: "struct",
      },
    ],
  },
  WorldMergeHistoryMaster: {
    file: "LGAマスター - ワールド統合履歴.tsv",
    fullName: "Soccer.Shared.WorldMergeHistoryMaster",
    extends: null,
    columns: [
      {
        name: "PrevWorldGroup",
        type: "WorldGroupMaster",
        kind: "ref",
        ref: "WorldGroupMaster",
      },
      {
        name: "MergedAt",
        type: "DateTimeOffset",
        kind: "struct",
      },
      {
        name: "WorldId",
        type: "ushort",
        kind: "int",
      },
      {
        name: "MergeHistories",
        type: "MergeHistory[]",
        kind: "array",
        element: "MergeHistory",
      },
    ],
  },
} as const;
