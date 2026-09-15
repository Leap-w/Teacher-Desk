<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect, AppTextarea } from '@/components/ui'
import { useStudentStore } from '@/stores/student'
import {
  CADRE_CUSTOM,
  CADRE_OPTIONS,
  FAMILY_SCOPE_OPTIONS,
  PRESET_CADRES,
  dormitoryOptions,
  isValidDormitory,
} from '@/utils/student'
import type { FamilyScope, Gender, SelectOption, Student, StudentInput } from '@/types'

interface Props {
  modelValue: boolean
  /** 传入则为编辑模式，否则为新增 */
  student?: Student
}

const props = withDefaults(defineProps<Props>(), {
  student: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: StudentInput]
}>()

const studentStore = useStudentStore()

const GENDER_OPTIONS: SelectOption<Gender>[] = [
  { label: '女', value: 'female' },
  { label: '男', value: 'male' },
]

interface FormState {
  name: string
  studentNo: string
  /** 身份证尾号（选填，最多 4 位）；重名时显示成「姓名（尾号）」 */
  idCardSuffix: string
  gender: Gender
  dormitory: string
  cadreRole: string
  /** 自定义职务的输入框内容；仅当 cadreRole === CADRE_CUSTOM 时参与提交 */
  cadreCustom: string
  tags: string
  phone: string
  remark: string
  familyAddress: string
  prefecture: string
  county: string
  /** 返家范围；空串表示未选择（提交时必选） */
  scope: string
}

function blankForm(): FormState {
  return {
    name: '',
    studentNo: '',
    idCardSuffix: '',
    gender: 'female',
    dormitory: '',
    cadreRole: '',
    cadreCustom: '',
    tags: '',
    phone: '',
    remark: '',
    familyAddress: '',
    prefecture: '',
    county: '',
    scope: '',
  }
}

const form = reactive<FormState>(blankForm())
const errors = reactive({ name: '', studentNo: '', scope: '' })

const modalTitle = computed(() => (props.student ? '编辑学生' : '新增学生'))

const isCustomCadre = computed(() => form.cadreRole === CADRE_CUSTOM)

/** 宿舍选项按性别分列：男生只能选男生楼，反之亦然 */
const dormitoryChoices = computed(() => dormitoryOptions(form.gender))

/**
 * 性别与宿舍是耦合的。改了性别后原来选中的房间可能已不在选项里——留着一个
 * 选不中的值，原生 `<select>` 会显示空白，但提交时它仍在 form 里，等于把女生
 * 悄悄存进了男生楼。所以一旦失配立刻清空，让教师重新选。
 */
watch(
  () => form.gender,
  (gender) => {
    if (form.dormitory && !isValidDormitory(form.dormitory, gender)) form.dormitory = ''
  },
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm())
    errors.name = ''
    errors.studentNo = ''
    errors.scope = ''
    if (!props.student) return

    // 既有职务不在预设里（上一轮导入或自定义录入的）→ 回填成「＋ 自定义」+ 输入框，
    // 否则原生 select 找不到匹配项会显示成「无」，一保存就把这个职务抹掉了
    const cadre = props.student.cadreRole ?? ''
    const cadreIsCustom = Boolean(cadre) && !PRESET_CADRES.includes(cadre)

    Object.assign(form, {
      name: props.student.name,
      studentNo: props.student.studentNo,
      idCardSuffix: props.student.idCardSuffix ?? '',
      gender: props.student.gender,
      dormitory: props.student.dormitory ?? '',
      cadreRole: cadreIsCustom ? CADRE_CUSTOM : cadre,
      cadreCustom: cadreIsCustom ? cadre : '',
      tags: (props.student.tags ?? []).join('，'),
      phone: props.student.phone ?? '',
      remark: props.student.remark ?? '',
      // 旧数据可能没有家庭信息（undefined），统一回退为空串
      familyAddress: props.student.familyAddress ?? '',
      prefecture: props.student.familyLocation?.prefecture ?? '',
      county: props.student.familyLocation?.county ?? '',
      scope: props.student.familyLocation?.scope ?? '',
    })
  },
)

function validate(): boolean {
  errors.name = form.name.trim() ? '' : '姓名不能为空'

  // 学号选填（Phase 5A）。空学号不是一个可用的身份键，因此不参与查重：
  // 拿空串互相判重，第二个「还没填学号」的学生就存不进去了
  const studentNo = form.studentNo.trim()
  if (!studentNo) {
    errors.studentNo = ''
  } else {
    const duplicated = studentStore.activeStudents.some(
      (item) => item.studentNo === studentNo && item.id !== props.student?.id,
    )
    errors.studentNo = duplicated ? '该学号已存在' : ''
  }

  // 返家范围是后续周末统计的基础，新增/编辑时均必选
  errors.scope = form.scope ? '' : '请选择返家范围'

  return !errors.name && !errors.studentNo && !errors.scope
}

/** 班委职务的最终值：自定义模式取输入框；哨兵值本身绝不入库 */
function cadreRoleValue(): string | undefined {
  const value = form.cadreRole === CADRE_CUSTOM ? form.cadreCustom.trim() : form.cadreRole
  return value || undefined
}

function submit() {
  if (!validate()) return
  const payload: StudentInput = {
    name: form.name.trim(),
    studentNo: form.studentNo.trim(),
    idCardSuffix: form.idCardSuffix.trim() || undefined,
    gender: form.gender,
    dormitory: form.dormitory || undefined,
    cadreRole: cadreRoleValue(),
    tags: form.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    phone: form.phone.trim() || undefined,
    remark: form.remark.trim() || undefined,
    familyAddress: form.familyAddress.trim(),
    familyLocation: {
      prefecture: form.prefecture.trim(),
      county: form.county.trim(),
      scope: form.scope as FamilyScope,
    },
  }
  // 刻意不带 seatNumber：档案已不维护座位号（Phase 5A），updateStudent 是浅合并，
  // 不传这个键就会原样保留既有值，座位方案的自动就座因此不受影响
  emit('submit', payload)
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" :title="modalTitle" :width="520" @update:model-value="close">
    <form class="student-form" @submit.prevent="submit">
      <div class="form-grid">
        <AppField label="姓名" required :error="errors.name">
          <AppInput v-model="form.name" :error="!!errors.name" placeholder="学生姓名" />
        </AppField>

        <AppField label="学号" :error="errors.studentNo" hint="选填">
          <AppInput
            v-model="form.studentNo"
            :error="!!errors.studentNo"
            placeholder="如 20230109"
          />
        </AppField>

        <AppField label="身份证尾号" hint="选填，最多 4 位；只在重名时显示，用来区分同名学生">
          <AppInput v-model="form.idCardSuffix" :maxlength="4" placeholder="如 4321" />
        </AppField>

        <AppField label="性别">
          <AppSelect v-model="form.gender" :options="GENDER_OPTIONS" />
        </AppField>

        <AppField label="宿舍" hint="女生 2 栋 / 男生 1 栋">
          <AppSelect v-model="form.dormitory" :options="dormitoryChoices" />
        </AppField>

        <AppField label="班委职务">
          <AppSelect v-model="form.cadreRole" :options="CADRE_OPTIONS" />
          <AppInput v-if="isCustomCadre" v-model="form.cadreCustom" placeholder="输入职务名称" />
        </AppField>

        <AppField label="联系电话">
          <AppInput v-model="form.phone" placeholder="选填" />
        </AppField>
      </div>

      <AppField label="标签" hint="多个标签用逗号分隔">
        <AppInput v-model="form.tags" placeholder="如：三好学生，体育骨干" />
      </AppField>

      <AppField label="备注">
        <AppTextarea v-model="form.remark" :rows="3" placeholder="选填" />
      </AppField>

      <h4 class="form-section">家庭信息</h4>

      <AppField label="返家范围" required :error="errors.scope">
        <AppSelect
          v-model="form.scope"
          :options="FAMILY_SCOPE_OPTIONS"
          placeholder="请选择返家范围"
          :error="!!errors.scope"
        />
      </AppField>

      <AppField label="所属地区">
        <AppInput v-model="form.prefecture" placeholder="如：昌都市 / 拉萨市" />
      </AppField>

      <AppField label="所属县/区">
        <AppInput v-model="form.county" placeholder="如：卡若区 / 江达县" />
      </AppField>

      <AppField label="家庭地址">
        <AppTextarea
          v-model="form.familyAddress"
          :rows="2"
          placeholder="如：西藏自治区昌都市卡若区××乡××村"
        />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4) var(--space-5);
  margin-bottom: var(--space-4);
}

.student-form :deep(.app-field) {
  margin-bottom: var(--space-4);
}

.student-form :deep(.app-field:last-child) {
  margin-bottom: 0;
}

.form-grid :deep(.app-field) {
  margin-bottom: 0;
}

.form-section {
  margin: var(--space-3) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
