// Event types for user interactions
export type UserResponseEventData = {
  projectId: string;
  response: string;
};

// Define event names as constants to avoid typos
export const USER_RESPONSE_EVENT = "project/user.response";
