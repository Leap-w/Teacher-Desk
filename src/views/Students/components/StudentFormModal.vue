<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect, AppTextarea } from '@/components/ui'
import { useStudentStore } from '@/stores/student'
import { FAMILY_SCOPE_OPTIONS } from '@/utils/student'
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

const BOARDING_OPTIONS: SelectOption<'boarding' | 'day'>[] = [
  { label: '住宿', value: 'boarding' },
  { label: '走读', value: 'day' },
]

const CADRE_OPTIONS: SelectOption<string>[] = [
  { label: '无', value: '' },
  { label: '班长', value: '班长' },
  { label: '副班长', value: '副班长' },
  { label: '学习委员', value: '学习委员' },
  { label: '体育委员', value: '体育委员' },
  { label: '文艺委员', value: '文艺委员' },
  { label: '劳动委员', value: '劳动委员' },
  { label: '生活委员', value: '生活委员' },
]

interface FormState {
  name: string
  studentNo: string
  gender: Gender
  seatNumber: string
  boarding: 'boarding' | 'day'
  dormitory: string
  cadreRole: string
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
    gender: 'female',
    seatNumber: '',
    boarding: 'day',
    dormitory: '',
    cadreRole: '',
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
const errors = reactive({ name: '', studentNo: '', seatNumber: '', scope: '' })

const modalTitle = computed(() => (props.student ? '编辑学生' : '新增学生'))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm())
    errors.name = ''
    errors.studentNo = ''
    errors.seatNumber = ''
    errors.scope = ''
    if (!props.student) return
    Object.assign(form, {
      name: props.student.name,
      studentNo: props.student.studentNo,
      gender: props.student.gender,
      seatNumber: props.student.seatNumber === undefined ? '' : String(props.student.seatNumber),
      boarding: props.student.boarding ? 'boarding' : 'day',
      dormitory: props.student.dormitory ?? '',
      cadreRole: props.student.cadreRole ?? '',
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

watch(
  () => form.boarding,
  (mode) => {
    if (mode === 'day') form.dormitory = ''
  },
)

function validate(): boolean {
  errors.name = form.name.trim() ? '' : '姓名不能为空'

  const studentNo = form.studentNo.trim()
  if (!studentNo) {
    errors.studentNo = '学号不能为空'
  } else {
    const duplicated = studentStore.activeStudents.some(
      (item) => item.studentNo === studentNo && item.id !== props.student?.id,
    )
    errors.studentNo = duplicated ? '该学号已存在' : ''
  }

  const seat = form.seatNumber.trim()
  if (!seat) {
    errors.seatNumber = ''
  } else {
    const seatValue = Number(seat)
    errors.seatNumber = Number.isInteger(seatValue) && seatValue >= 0 ? '' : '座位号需为非负整数'
  }

  // 返家范围是后续周末统计的基础，新增/编辑时均必选
  errors.scope = form.scope ? '' : '请选择返家范围'

  return !errors.name && !errors.studentNo && !errors.seatNumber && !errors.scope
}

function submit() {
  if (!validate()) return
  const payload: StudentInput = {
    name: form.name.trim(),
    studentNo: form.studentNo.trim(),
    gender: form.gender,
    seatNumber: form.seatNumber.trim() === '' ? undefined : Number(form.seatNumber),
    boarding: form.boarding === 'boarding',
    dormitory: form.dormitory.trim() || undefined,
    cadreRole: form.cadreRole || undefined,
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

        <AppField label="学号" required :error="errors.studentNo">
          <AppInput
            v-model="form.studentNo"
            :error="!!errors.studentNo"
            placeholder="如 20230109"
          />
        </AppField>

        <AppField label="性别">
          <AppSelect v-model="form.gender" :options="GENDER_OPTIONS" />
        </AppField>

        <AppField label="座位号" :error="errors.seatNumber" hint="留空表示未排座">
          <AppInput v-model="form.seatNumber" :error="!!errors.seatNumber" placeholder="如 12" />
        </AppField>

        <AppField label="住宿情况">
          <AppSelect v-model="form.boarding" :options="BOARDING_OPTIONS" />
        </AppField>

        <AppField label="宿舍">
          <AppInput
            v-model="form.dormitory"
            placeholder="如 3 号楼 412"
            :disabled="form.boarding === 'day'"
          />
        </AppField>

        <AppField label="班委职务">
          <AppSelect v-model="form.cadreRole" :options="CADRE_OPTIONS" />
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
