const API_BASE_URL = "https://tasks-manager-back.onrender.com";

const projectsContainer = document.querySelector("#projects");
const projectStatus = document.querySelector("#project-status");
const apiErrorBanner = document.querySelector("#api-error");
const taskDialog = document.querySelector("#task-dialog");
const taskDialogTitle = document.querySelector("#task-dialog-title");
const taskDetails = document.querySelector("#task-details");
const closeDialogButton = document.querySelector("#close-dialog");
const previousPageButton = document.querySelector("#previous-page");
const nextPageButton = document.querySelector("#next-page");
const projectFormDialog = document.querySelector("#project-form-dialog");
const taskFormDialog = document.querySelector("#task-form-dialog");
const projectForm = document.querySelector("#project-form");
const taskForm = document.querySelector("#task-form");
const addProjectButton = document.querySelector("#add-project-button");
const editTaskButton = document.querySelector("#edit-task-button");

const PROJECTS_PER_PAGE = 10;
let projectsOffset = 0;
let currentProjects = [];
let isLoadingProjects = false;
let selectedProjectId = null;
let editingProjectId = null;
let editingTaskId = null;
let currentTask = null;

// Зберігає статус і тип сутності, щоб показати відповідну помилку в banner.
class ApiRequestError extends Error {
  constructor(status, entity) {
    super(`API request failed with status ${status}`);
    this.status = status;
    this.entity = entity;
  }
}

function showApiError(error, entity) {
  console.error("Помилка запиту до API:", error);

  if (error instanceof ApiRequestError && error.status === 404) {
    apiErrorBanner.textContent =
      (error.entity ?? entity) === "task"
        ? "Завдання не знайдено (можливо, вже видалено)"
        : "Проєкт не знайдено (можливо, вже видалено)";
  } else if (error instanceof ApiRequestError && error.status === 422) {
    apiErrorBanner.textContent = "Перевірте правильність заповнення форми";
  } else if (error instanceof TypeError) {
    apiErrorBanner.textContent = "Не вдалося з'єднатися з сервером.";
  } else {
    apiErrorBanner.textContent = "Не вдалося виконати запит. Спробуйте ще раз.";
  }

  apiErrorBanner.hidden = false;
}

// Усі HTTP-запити проходять тут, щоб однаково обробляти відповіді та banner.
async function apiRequest(url, options, entity) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new ApiRequestError(response.status, entity);
  }

  apiErrorBanner.hidden = true;
  return response;
}

function updatePaginationButtons() {
  // Наступна сторінка можлива лише тоді, коли поточна заповнена повністю.
  previousPageButton.disabled = isLoadingProjects || projectsOffset === 0;
  nextPageButton.disabled =
    isLoadingProjects || currentProjects.length < PROJECTS_PER_PAGE;
}

// Створює текстовий елемент без інтерпретації даних API як HTML.
function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function clearFormErrors(form) {
  for (const errorElement of form.querySelectorAll(".field-error")) {
    errorElement.textContent = "";
  }
}

function showFormErrors(form, errors) {
  clearFormErrors(form);
  for (const [fieldName, message] of Object.entries(errors)) {
    const errorElement = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (errorElement) {
      errorElement.textContent = message;
    }
  }
}

function validateRequiredText(form, fieldName, label, maxLength) {
  const field = form.elements.namedItem(fieldName);
  const value = field.value.trim();
  const errors = {};

  if (!value) {
    errors[fieldName] = `${label} є обов'язковою.`;
  } else if (value.length > maxLength) {
    errors[fieldName] = `Максимум ${maxLength} символів.`;
  }

  return { value, errors };
}

function getFieldValue(form, fieldName) {
  return form.elements.namedItem(fieldName).value.trim();
}

function formatDoneState(isDone) {
  return isDone === true ? "Виконано" : "В процесі";
}

function renderTasks(taskList, tasks, projectId) {
  taskList.replaceChildren();

  if (!Array.isArray(tasks) || tasks.length === 0) {
    taskList.append(createTextElement("li", "empty-tasks", "Завдання не додані"));
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = "task-row";

    const titleButton = createTextElement("button", "task-title", task.title ?? "");
    titleButton.type = "button";
    titleButton.addEventListener("click", () => loadTaskDetails(task.id, projectId));

    const state = createTextElement("span", "task-state", formatDoneState(task.is_done));
    const actions = document.createElement("div");
    actions.className = "task-actions";
    const deleteButton = createTextElement("button", "danger-action", "Видалити");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => {
      void deleteTask(task.id, projectId, item);
    });
    actions.append(deleteButton);
    item.append(titleButton, state, actions);
    taskList.append(item);
  }
}

async function loadProjectTasks(project, taskList, forceRefresh = false) {
  if (!forceRefresh && Array.isArray(project.tasks)) {
    renderTasks(taskList, project.tasks, project.id);
    return;
  }

  // Якщо список проєктів не містить завдань, завантажуємо розширені дані проєкту.
  try {
    const response = await apiRequest(
      `${API_BASE_URL}/projects/${encodeURIComponent(project.id)}`,
      undefined,
      "project",
    );

    const projectDetails = await response.json();
    project.tasks = projectDetails.tasks;
    renderTasks(taskList, projectDetails.tasks, project.id);
  } catch (error) {
    showApiError(error, "project");
  }
}

function renderProjects(projects) {
  projectsContainer.replaceChildren();

  if (!Array.isArray(projects) || projects.length === 0) {
    projectStatus.textContent = "Проєктів поки немає";
    projectStatus.hidden = false;
    return;
  }

  projectStatus.hidden = true;

  for (const project of projects) {
    const projectElement = document.createElement("details");
    projectElement.className = "project";
    projectElement.dataset.projectId = project.id;

    const summary = document.createElement("summary");
    summary.append(createTextElement("span", "project-name", project.name ?? ""));
    projectElement.append(summary);

    const content = document.createElement("div");
    content.className = "project-content";
    content.append(createTextElement("p", "project-description", project.description ?? ""));

    const projectActions = document.createElement("div");
    projectActions.className = "project-actions";

    const editProjectButton = createTextElement("button", "secondary-action", "Редагувати");
    editProjectButton.type = "button";
    editProjectButton.addEventListener("click", () => openProjectForm(project));
    const deleteProjectButton = createTextElement("button", "danger-action", "Видалити");
    deleteProjectButton.type = "button";
    deleteProjectButton.addEventListener("click", () => {
      void deleteProject(project.id, project.name);
    });
    projectActions.append(editProjectButton, deleteProjectButton);
    content.append(projectActions);

    const taskList = document.createElement("ul");
    taskList.className = "task-list";
    content.append(taskList);

    const addTaskButton = createTextElement("button", "add-task-button", "Додати завдання");
    addTaskButton.type = "button";
    addTaskButton.addEventListener("click", () => openTaskForm(project.id));
    content.append(addTaskButton);

    projectElement.append(content);

    projectElement.addEventListener("toggle", () => {
      // Завдання отримуємо лише під час першого розкриття проєкту.
      if (projectElement.open && taskList.childElementCount === 0) {
        void loadProjectTasks(project, taskList);
      }
    });

    projectsContainer.append(projectElement);
  }
}

function renderTaskDetails(task) {
  taskDialogTitle.textContent = task.title ?? "Завдання";
  taskDetails.replaceChildren();
  taskDetails.className = "task-details";

  const fields = [
    ["Опис", task.description ?? ""],
    ["Статус", formatDoneState(task.is_done)],
    ["Термін виконання", task.due_date ?? "Не вказано"],
    ["Пріоритет", task.priority ?? "Не вказано"],
  ];

  for (const [label, value] of fields) {
    const field = document.createElement("div");
    field.append(
      createTextElement("dt", "", label),
      createTextElement("dd", "", String(value)),
    );
    taskDetails.append(field);
  }
}

async function loadTaskDetails(taskId, projectId) {
  try {
    const response = await apiRequest(
      `${API_BASE_URL}/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      "task",
    );

    const task = await response.json();
    currentTask = task;
    selectedProjectId = projectId ?? task.project_id ?? selectedProjectId;
    renderTaskDetails(task);
    taskDialog.showModal();
  } catch (error) {
    showApiError(error, "task");
  }
}

async function loadProjects(offset = projectsOffset) {
  isLoadingProjects = true;
  updatePaginationButtons();

  try {
    const query = new URLSearchParams({
      limit: String(PROJECTS_PER_PAGE),
      offset: String(offset),
    });
    const response = await apiRequest(`${API_BASE_URL}/projects/?${query}`, undefined, "project");

    const projects = await response.json();
    projectsOffset = offset;
    currentProjects = projects;
    renderProjects(projects);
  } catch (error) {
    projectStatus.hidden = true;
    showApiError(error, "project");
  } finally {
    isLoadingProjects = false;
    updatePaginationButtons();
  }
}

function openProjectForm(project = null) {
  // Наявність проєкту перемикає спільну форму зі створення на редагування.
  editingProjectId = project?.id ?? null;
  projectForm.reset();
  clearFormErrors(projectForm);
  projectForm.elements.namedItem("name").value = project?.name ?? "";
  projectForm.elements.namedItem("description").value = project?.description ?? "";
  projectForm.querySelector('[type="submit"]').textContent =
    editingProjectId === null ? "Створити проєкт" : "Зберегти зміни";
  document.querySelector("#project-form-title").textContent =
    editingProjectId === null ? "Новий проєкт" : "Редагувати проєкт";
  projectFormDialog.showModal();
  projectForm.elements.namedItem("name").focus();
}

function openTaskForm(projectId) {
  selectedProjectId = projectId;
  editingTaskId = null;
  taskForm.reset();
  taskForm.elements.namedItem("priority").value = "medium";
  clearFormErrors(taskForm);
  taskForm.querySelector('[type="submit"]').textContent = "Створити завдання";
  document.querySelector("#task-form-title").textContent = "Нове завдання";
  taskFormDialog.showModal();
  taskForm.elements.namedItem("title").focus();
}

function openTaskEditForm() {
  if (!currentTask) {
    return;
  }

  editingTaskId = currentTask.id;
  taskForm.reset();
  clearFormErrors(taskForm);
  taskForm.elements.namedItem("title").value = currentTask.title ?? "";
  taskForm.elements.namedItem("description").value = currentTask.description ?? "";
  taskForm.elements.namedItem("priority").value = currentTask.priority ?? "medium";
  taskForm.elements.namedItem("due_date").value = currentTask.due_date
    ? String(currentTask.due_date).slice(0, 10)
    : "";
  taskForm.querySelector('[type="submit"]').textContent = "Зберегти зміни";
  document.querySelector("#task-form-title").textContent = "Редагувати завдання";
  taskDialog.close();
  taskFormDialog.showModal();
}

async function submitProjectForm(event) {
  event.preventDefault();
  const { value: name, errors } = validateRequiredText(projectForm, "name", "Назва", 200);
  showFormErrors(projectForm, errors);
  if (Object.keys(errors).length > 0) {
    return;
  }

  const submitButton = projectForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    // Та сама форма виконує POST для створення та PATCH для редагування.
    const isEditing = editingProjectId !== null;
    const url = isEditing
      ? `${API_BASE_URL}/projects/${encodeURIComponent(editingProjectId)}`
      : `${API_BASE_URL}/projects/`;
    const response = await apiRequest(
      url,
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: getFieldValue(projectForm, "description"),
        }),
      },
      "project",
    );

    projectFormDialog.close();
    if (!isEditing) {
      projectsOffset = 0;
    }
    editingProjectId = null;
    await loadProjects(projectsOffset);
  } catch (error) {
    showApiError(error, "project");
  } finally {
    submitButton.disabled = false;
  }
}

async function submitTaskForm(event) {
  event.preventDefault();

  const { value: title, errors } = validateRequiredText(taskForm, "title", "Назва", 150);
  const dueDate = getFieldValue(taskForm, "due_date");
  if (dueDate) {
    // Порівнюємо календарні дати від початку дня, а не поточний час.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(`${dueDate}T00:00:00`);
    if (selectedDate <= today) {
      errors.due_date = "Дата завершення має бути пізніше сьогоднішньої дати.";
    }
  }
  showFormErrors(taskForm, errors);
  if (Object.keys(errors).length > 0) {
    return;
  }

  const submitButton = taskForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    // За режимом форми обираємо створення завдання або його редагування.
    const isEditing = editingTaskId !== null;
    const url = isEditing
      ? `${API_BASE_URL}/tasks/${encodeURIComponent(editingTaskId)}`
      : `${API_BASE_URL}/projects/${encodeURIComponent(selectedProjectId)}/tasks`;
    const response = await apiRequest(
      url,
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: getFieldValue(taskForm, "description"),
          priority: getFieldValue(taskForm, "priority"),
          due_date: dueDate || null,
        }),
      },
      "task",
    );

    taskFormDialog.close();
    editingTaskId = null;
    await loadProjects(projectsOffset);
    const createdProject = [...projectsContainer.querySelectorAll(".project")].find(
      (projectElement) => projectElement.dataset.projectId === String(selectedProjectId),
    );
    const updatedProject = currentProjects.find(
      (project) => String(project.id) === String(selectedProjectId),
    );
    if (createdProject && updatedProject) {
      const taskList = createdProject.querySelector(".task-list");
      await loadProjectTasks(updatedProject, taskList, true);
      createdProject.open = true;
    }
  } catch (error) {
    showApiError(error, "task");
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteProject(projectId, projectName) {
  if (!confirm(`Видалити проєкт «${projectName}» разом з усіма його завданнями?`)) {
    return;
  }

  try {
    await apiRequest(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}`,
      { method: "DELETE" },
      "project",
    );

    // Якщо видалено останній проєкт сторінки, повертаємося на попередню.
    const deletedLastProjectOnPage = currentProjects.length === 1 && projectsOffset > 0;
    await loadProjects(
      deletedLastProjectOnPage
        ? Math.max(0, projectsOffset - PROJECTS_PER_PAGE)
        : projectsOffset,
    );
  } catch (error) {
    showApiError(error, "project");
  }
}

async function deleteTask(taskId, projectId, taskElement) {
  if (!confirm("Видалити це завдання?")) {
    return;
  }

  try {
    await apiRequest(
      `${API_BASE_URL}/tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
      "task",
    );

    taskElement.remove();
    if (taskElement.parentElement.childElementCount === 0) {
      taskElement.parentElement.append(
        createTextElement("li", "empty-tasks", "Завдання не додані"),
      );
    }

    const project = currentProjects.find(
      (item) => String(item.id) === String(projectId),
    );
    // Оновлюємо локальний список, щоб після повторного відкриття дані були актуальні.
    if (Array.isArray(project?.tasks)) {
      project.tasks = project.tasks.filter((task) => String(task.id) !== String(taskId));
    }

    if (currentTask && String(currentTask.id) === String(taskId)) {
      taskDialog.close();
      currentTask = null;
    }
  } catch (error) {
    showApiError(error, "task");
  }
}

closeDialogButton.addEventListener("click", () => taskDialog.close());
addProjectButton.addEventListener("click", openProjectForm);
projectForm.addEventListener("submit", submitProjectForm);
taskForm.addEventListener("submit", submitTaskForm);
editTaskButton.addEventListener("click", openTaskEditForm);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`).close();
  });
});
previousPageButton.addEventListener("click", () => {
  if (projectsOffset > 0) {
    void loadProjects(Math.max(0, projectsOffset - PROJECTS_PER_PAGE));
  }
});
nextPageButton.addEventListener("click", () => {
  if (currentProjects.length === PROJECTS_PER_PAGE) {
    void loadProjects(projectsOffset + PROJECTS_PER_PAGE);
  }
});

// Завантажуємо першу сторінку одразу після готовності DOM.
void loadProjects();
