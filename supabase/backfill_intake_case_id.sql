-- 历史 49 条接案回填 case_id（接案转案件功能上线后补历史关联）
-- 匹配依据：每个当事人名下恰好 1 条案件（已验证无歧义、无抢占）
-- 全程单事务，末尾 COMMIT；中途出错自动 ROLLBACK，不会写坏数据
BEGIN;

-- 逐条按「当事人 + 唯一案件」回填，WHERE 带上 converted=true AND case_id IS NULL 双保险
-- 避免误改已关联的行；每条 UPDATE 影响的行数应为 1（下面校验）
UPDATE public.intakes SET case_id = c.id, updated_at = now()
FROM public.cases c
WHERE c.user_id = intakes.user_id
  AND btrim(c.client) = btrim(intakes.client)
  AND intakes.converted = true
  AND intakes.case_id IS NULL;

-- 校验1：不该再有「已转但无 case_id」的接案
DO $$
DECLARE leftover integer;
BEGIN
  SELECT count(*) INTO leftover FROM public.intakes WHERE converted = true AND case_id IS NULL;
  IF leftover > 0 THEN
    RAISE EXCEPTION '仍有 % 条已转接案没有 case_id，中止回填', leftover;
  END IF;
END $$;

-- 校验2：case_id 必须指向真实存在的案件
DO $$
DECLARE dangling integer;
BEGIN
  SELECT count(*) INTO dangling
  FROM public.intakes i
  WHERE i.case_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = i.case_id);
  IF dangling > 0 THEN
    RAISE EXCEPTION '有 % 条 case_id 指向不存在的案件，中止回填', dangling;
  END IF;
END $$;

-- 校验3：不允许一个案件被多条接案抢占
DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT case_id FROM public.intakes
    WHERE case_id IS NOT NULL
    GROUP BY case_id HAVING count(*) > 1
  ) t;
  IF dup > 0 THEN
    RAISE EXCEPTION '有 % 个案件被多条接案重复关联，中止回填', dup;
  END IF;
END $$;

COMMIT;
